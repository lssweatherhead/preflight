(function () {
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.MainController
 * @function
 * 
 * @description
 * The main application controller
 * 
 */
    function MainController($scope, $location, appState, treeService, notificationsService, userService, historyService, updateChecker, assetsService, eventsService, tmhDynamicLocale, localStorageService, editorService, overlayService) {
        //the null is important because we do an explicit bool check on this in the view
        $scope.authenticated = null;
        $scope.touchDevice = appState.getGlobalState('touchDevice');
        $scope.infiniteMode = false;
        $scope.overlay = {};
        $scope.drawer = {};
        $scope.search = {};
        $scope.login = {};
        $scope.removeNotification = function (index) {
            notificationsService.remove(index);
        };
        $scope.closeSearch = function () {
            appState.setSearchState('show', false);
        };
        $scope.showLoginScreen = function (isTimedOut) {
            $scope.login.isTimedOut = isTimedOut;
            $scope.login.show = true;
        };
        $scope.hideLoginScreen = function () {
            $scope.login.show = false;
        };
        var evts = [];
        //when a user logs out or timesout
        evts.push(eventsService.on('app.notAuthenticated', function (evt, data) {
            $scope.authenticated = null;
            $scope.user = null;
            var isTimedOut = data && data.isTimedOut ? true : false;
            $scope.showLoginScreen(isTimedOut);
        }));
        evts.push(eventsService.on('app.userRefresh', function (evt) {
            userService.refreshCurrentUser().then(function (data) {
                $scope.user = data;
                //Load locale file
                if ($scope.user.locale) {
                    tmhDynamicLocale.set($scope.user.locale);
                }
            });
        }));
        //when the app is ready/user is logged in, setup the data
        evts.push(eventsService.on('app.ready', function (evt, data) {
            $scope.authenticated = data.authenticated;
            $scope.user = data.user;
            updateChecker.check().then(function (update) {
                if (update && update !== 'null') {
                    if (update.type !== 'None') {
                        var notification = {
                            headline: 'Update available',
                            message: 'Click to download',
                            sticky: true,
                            type: 'info',
                            url: update.url
                        };
                        notificationsService.add(notification);
                    }
                }
            });
            //if the user has changed we need to redirect to the root so they don't try to continue editing the
            //last item in the URL (NOTE: the user id can equal zero, so we cannot just do !data.lastUserId since that will resolve to true)
            if (data.lastUserId !== undefined && data.lastUserId !== null && data.lastUserId !== data.user.id) {
                $location.path('/').search('');
                historyService.removeAll();
                treeService.clearCache();
                editorService.closeAll();
                overlayService.close();
                //if the user changed, clearout local storage too - could contain sensitive data
                localStorageService.clearAll();
            }
            //if this is a new login (i.e. the user entered credentials), then clear out local storage - could contain sensitive data
            if (data.loginType === 'credentials') {
                localStorageService.clearAll();
            }
            //Load locale file
            if ($scope.user.locale) {
                tmhDynamicLocale.set($scope.user.locale);
            }
        }));
        evts.push(eventsService.on('app.ysod', function (name, error) {
            $scope.ysodOverlay = {
                view: 'ysod',
                error: error,
                show: true
            };
        }));
        // events for search
        evts.push(eventsService.on('appState.searchState.changed', function (e, args) {
            if (args.key === 'show') {
                $scope.search.show = args.value;
            }
        }));
        // events for drawer
        // manage the help dialog by subscribing to the showHelp appState
        evts.push(eventsService.on('appState.drawerState.changed', function (e, args) {
            // set view
            if (args.key === 'view') {
                $scope.drawer.view = args.value;
            }
            // set custom model
            if (args.key === 'model') {
                $scope.drawer.model = args.value;
            }
            // show / hide drawer
            if (args.key === 'showDrawer') {
                $scope.drawer.show = args.value;
            }
        }));
        // events for overlays
        evts.push(eventsService.on('appState.overlay', function (name, args) {
            $scope.overlay = args;
        }));
        // events for tours
        evts.push(eventsService.on('appState.tour.start', function (name, args) {
            $scope.tour = args;
            $scope.tour.show = true;
        }));
        evts.push(eventsService.on('appState.tour.end', function () {
            $scope.tour = null;
        }));
        evts.push(eventsService.on('appState.tour.complete', function () {
            $scope.tour = null;
        }));
        // events for backdrop
        evts.push(eventsService.on('appState.backdrop', function (name, args) {
            $scope.backdrop = args;
        }));
        // event for infinite editors
        evts.push(eventsService.on('appState.editors.open', function (name, args) {
            $scope.infiniteMode = args && args.editors.length > 0 ? true : false;
        }));
        evts.push(eventsService.on('appState.editors.close', function (name, args) {
            $scope.infiniteMode = args && args.editors.length > 0 ? true : false;
        }));
        //ensure to unregister from all events!
        $scope.$on('$destroy', function () {
            for (var e in evts) {
                eventsService.unsubscribe(evts[e]);
            }
        });
    }
    //register it
    angular.module('umbraco').controller('Umbraco.MainController', MainController).config(function (tmhDynamicLocaleProvider) {
        //Set url for locale files
        tmhDynamicLocaleProvider.localeLocationPattern('lib/angular-i18n/angular-locale_{{locale}}.js');
    });
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.NavigationController
 * @function
 *
 * @description
 * Handles the section area of the app
 *
 * @param {navigationService} navigationService A reference to the navigationService
 */
    function NavigationController($scope, $rootScope, $location, $log, $q, $routeParams, $timeout, treeService, appState, navigationService, keyboardService, historyService, eventsService, angularHelper, languageResource, contentResource) {
        //this is used to trigger the tree to start loading once everything is ready
        var treeInitPromise = $q.defer();
        $scope.treeApi = {};
        //Bind to the main tree events
        $scope.onTreeInit = function () {
            $scope.treeApi.callbacks.treeNodeExpanded(nodeExpandedHandler);
            //when a tree is loaded into a section, we need to put it into appState
            $scope.treeApi.callbacks.treeLoaded(function (args) {
                appState.setTreeState('currentRootNode', args.tree);
            });
            //when a tree node is synced this event will fire, this allows us to set the currentNode
            $scope.treeApi.callbacks.treeSynced(function (args) {
                if (args.activate === undefined || args.activate === true) {
                    //set the current selected node
                    appState.setTreeState('selectedNode', args.node);
                    //when a node is activated, this is the same as clicking it and we need to set the
                    //current menu item to be this node as well.
                    appState.setMenuState('currentNode', args.node);
                }
            });
            //this reacts to the options item in the tree
            $scope.treeApi.callbacks.treeOptionsClick(function (args) {
                args.event.stopPropagation();
                args.event.preventDefault();
                //Set the current action node (this is not the same as the current selected node!)
                appState.setMenuState('currentNode', args.node);
                if (args.event && args.event.altKey) {
                    args.skipDefault = true;
                }
                navigationService.showMenu(args);
            });
            $scope.treeApi.callbacks.treeNodeAltSelect(function (args) {
                args.event.stopPropagation();
                args.event.preventDefault();
                args.skipDefault = true;
                navigationService.showMenu(args);
            });
            //this reacts to tree items themselves being clicked
            //the tree directive should not contain any handling, simply just bubble events
            $scope.treeApi.callbacks.treeNodeSelect(function (args) {
                var n = args.node;
                args.event.stopPropagation();
                args.event.preventDefault();
                if (n.metaData && n.metaData['jsClickCallback'] && angular.isString(n.metaData['jsClickCallback']) && n.metaData['jsClickCallback'] !== '') {
                    //this is a legacy tree node!
                    var jsPrefix = 'javascript:';
                    var js;
                    if (n.metaData['jsClickCallback'].startsWith(jsPrefix)) {
                        js = n.metaData['jsClickCallback'].substr(jsPrefix.length);
                    } else {
                        js = n.metaData['jsClickCallback'];
                    }
                    try {
                        var func = eval(js);
                        //this is normally not necessary since the eval above should execute the method and will return nothing.
                        if (func != null && typeof func === 'function') {
                            func.call();
                        }
                    } catch (ex) {
                        $log.error('Error evaluating js callback from legacy tree node: ' + ex);
                    }
                } else if (n.routePath) {
                    //add action to the history service
                    historyService.add({
                        name: n.name,
                        link: n.routePath,
                        icon: n.icon
                    });
                    //put this node into the tree state
                    appState.setTreeState('selectedNode', args.node);
                    //when a node is clicked we also need to set the active menu node to this node
                    appState.setMenuState('currentNode', args.node);
                    //not legacy, lets just set the route value and clear the query string if there is one.
                    $location.path(n.routePath);
                    navigationService.clearSearch();
                } else if (n.section) {
                    $location.path(n.section);
                    navigationService.clearSearch();
                }
                navigationService.hideNavigation();
            });
            return treeInitPromise.promise;
        };
        //set up our scope vars
        $scope.showContextMenuDialog = false;
        $scope.showContextMenu = false;
        $scope.showSearchResults = false;
        $scope.menuDialogTitle = null;
        $scope.menuActions = [];
        $scope.menuNode = null;
        $scope.languages = [];
        $scope.selectedLanguage = {};
        $scope.page = {};
        $scope.page.languageSelectorIsOpen = false;
        $scope.currentSection = null;
        $scope.customTreeParams = null;
        $scope.treeCacheKey = '_';
        $scope.showNavigation = appState.getGlobalState('showNavigation');
        // tracks all expanded paths so when the language is switched we can resync it with the already loaded paths
        var expandedPaths = [];
        //trigger search with a hotkey:
        keyboardService.bind('ctrl+shift+s', function () {
            navigationService.showSearch();
        });
        ////TODO: remove this it's not a thing
        //$scope.selectedId = navigationService.currentId;
        var evts = [];
        //Listen for global state changes
        evts.push(eventsService.on('appState.globalState.changed', function (e, args) {
            if (args.key === 'showNavigation') {
                $scope.showNavigation = args.value;
            }
        }));
        //Listen for menu state changes
        evts.push(eventsService.on('appState.menuState.changed', function (e, args) {
            if (args.key === 'showMenuDialog') {
                $scope.showContextMenuDialog = args.value;
            }
            if (args.key === 'dialogTemplateUrl') {
                $scope.dialogTemplateUrl = args.value;
            }
            if (args.key === 'showMenu') {
                $scope.showContextMenu = args.value;
            }
            if (args.key === 'dialogTitle') {
                $scope.menuDialogTitle = args.value;
            }
            if (args.key === 'menuActions') {
                $scope.menuActions = args.value;
            }
            if (args.key === 'currentNode') {
                $scope.menuNode = args.value;
            }
        }));
        //Listen for tree state changes
        evts.push(eventsService.on('appState.treeState.changed', function (e, args) {
            if (args.key === 'currentRootNode') {
                //if the changed state is the currentRootNode, determine if this is a full screen app
                if (args.value.root && args.value.root.containsTrees === false) {
                    $rootScope.emptySection = true;
                } else {
                    $rootScope.emptySection = false;
                }
            }
        }));
        //Listen for section state changes
        evts.push(eventsService.on('appState.sectionState.changed', function (e, args) {
            //section changed
            if (args.key === 'currentSection' && $scope.currentSection != args.value) {
                //before loading the main tree we need to ensure that the nav is ready
                navigationService.waitForNavReady().then(function () {
                    $scope.currentSection = args.value;
                    //load the tree
                    configureTreeAndLanguages();
                    $scope.treeApi.load({
                        section: $scope.currentSection,
                        customTreeParams: $scope.customTreeParams,
                        cacheKey: $scope.treeCacheKey
                    });
                });
            }
            //show/hide search results
            if (args.key === 'showSearchResults') {
                $scope.showSearchResults = args.value;
            }
        }));
        // Listen for language updates
        evts.push(eventsService.on('editors.languages.languageDeleted', function (e, args) {
            loadLanguages().then(function (languages) {
                $scope.languages = languages;
            });
        }));
        //Emitted when a language is created or an existing one saved/edited
        evts.push(eventsService.on('editors.languages.languageSaved', function (e, args) {
            console.log('lang event listen args', args);
            if (args.isNew) {
                //A new language has been created - reload languages for tree
                loadLanguages().then(function (languages) {
                    $scope.languages = languages;
                });
            } else if (args.language.isDefault) {
                //A language was saved and was set to be the new default (refresh the tree, so its at the top)
                loadLanguages().then(function (languages) {
                    $scope.languages = languages;
                });
            }
        }));
        //when a user logs out or timesout
        evts.push(eventsService.on('app.notAuthenticated', function () {
            $scope.authenticated = false;
        }));
        //when the application is ready and the user is authorized, setup the data
        evts.push(eventsService.on('app.ready', function (evt, data) {
            init();
        }));
        // event for infinite editors
        evts.push(eventsService.on('appState.editors.open', function (name, args) {
            $scope.infiniteMode = args && args.editors.length > 0 ? true : false;
        }));
        evts.push(eventsService.on('appState.editors.close', function (name, args) {
            $scope.infiniteMode = args && args.editors.length > 0 ? true : false;
        }));
        /**
   * Based on the current state of the application, this configures the scope variables that control the main tree and language drop down
   */
        function configureTreeAndLanguages() {
            //create the custom query string param for this tree, this is currently only relevant for content
            if ($scope.currentSection === 'content') {
                //must use $location here because $routeParams isn't available until after the route change
                var mainCulture = $location.search().mculture;
                //select the current language if set in the query string
                if (mainCulture && $scope.languages && $scope.languages.length > 1) {
                    var found = _.find($scope.languages, function (l) {
                        return l.culture.toLowerCase() === mainCulture.toLowerCase();
                    });
                    if (found) {
                        //set the route param
                        found.active = true;
                        $scope.selectedLanguage = found;
                    }
                }
                var queryParams = {};
                if ($scope.selectedLanguage && $scope.selectedLanguage.culture) {
                    queryParams['culture'] = $scope.selectedLanguage.culture;
                }
                var queryString = $.param(queryParams);    //create the query string from the params object
            }
            if (queryString) {
                $scope.customTreeParams = queryString;
                $scope.treeCacheKey = queryString;    // this tree uses caching but we need to change it's cache key per lang
            } else {
                $scope.treeCacheKey = '_';    // this tree uses caching, there's no lang selected so use the default
            }
        }
        /**
   * Called when the app is ready and sets up the navigation (should only be called once)
   */
        function init() {
            $scope.authenticated = true;
            var navInit = false;
            //$routeParams will be populated after $routeChangeSuccess since this controller is used outside ng-view,
            //* we listen for the first route change with a section to setup the navigation.
            //* we listen for all route changes to track the current section.
            $rootScope.$on('$routeChangeSuccess', function () {
                //only continue if there's a section available
                if ($routeParams.section) {
                    if (!navInit) {
                        navInit = true;
                        initNav();
                    }
                    //keep track of the current section when it changes
                    if ($scope.currentSection != $routeParams.section) {
                        appState.setSectionState('currentSection', $routeParams.section);
                    }
                }
            });
        }
        /**
   * This loads the language data, if the are no variant content types configured this will return no languages
   */
        function loadLanguages() {
            return contentResource.allowsCultureVariation().then(function (b) {
                if (b === true) {
                    return languageResource.getAll();
                } else {
                    return $q.when([]);    //resolve an empty collection
                }
            });
        }
        /**
   * Called once during init to initialize the navigation/tree/languages
   */
        function initNav() {
            // load languages
            loadLanguages().then(function (languages) {
                $scope.languages = languages;
                if ($scope.languages.length > 1) {
                    var defaultLang = _.find($scope.languages, function (l) {
                        return l.isDefault;
                    });
                    //if there's already one set, check if it exists
                    var currCulture = null;
                    var mainCulture = $location.search().mculture;
                    if (mainCulture) {
                        currCulture = _.find($scope.languages, function (l) {
                            return l.culture.toLowerCase() === mainCulture.toLowerCase();
                        });
                    }
                    if (!currCulture) {
                        $location.search('mculture', defaultLang ? defaultLang.culture : null);
                    }
                }
                $scope.currentSection = $routeParams.section;
                configureTreeAndLanguages();
                //resolve the tree promise, set it's property values for loading the tree which will make the tree load
                treeInitPromise.resolve({
                    section: $scope.currentSection,
                    customTreeParams: $scope.customTreeParams,
                    cacheKey: $scope.treeCacheKey,
                    //because angular doesn't return a promise for the resolve method, we need to resort to some hackery, else
                    //like normal JS promises we could do resolve(...).then()
                    onLoaded: function onLoaded() {
                        //the nav is ready, let the app know
                        eventsService.emit('app.navigationReady', { treeApi: $scope.treeApi });
                    }
                });
            });
        }
        function nodeExpandedHandler(args) {
            //store the reference to the expanded node path
            if (args.node) {
                treeService._trackExpandedPaths(args.node, expandedPaths);
            }
        }
        $scope.selectLanguage = function (language) {
            $location.search('mculture', language.culture);
            // close the language selector
            $scope.page.languageSelectorIsOpen = false;
            configureTreeAndLanguages();
            //re-bind language to the query string and update the tree params
            //reload the tree with it's updated querystring args
            $scope.treeApi.load({
                section: $scope.currentSection,
                customTreeParams: $scope.customTreeParams,
                cacheKey: $scope.treeCacheKey
            }).then(function () {
                //re-sync to currently edited node
                var currNode = appState.getTreeState('selectedNode');
                //create the list of promises
                var promises = [];
                //starting with syncing to the currently selected node if there is one
                if (currNode) {
                    var path = treeService.getPath(currNode);
                    promises.push($scope.treeApi.syncTree({
                        path: path,
                        activate: true
                    }));
                }
                //TODO: If we want to keep all paths expanded ... but we need more testing since we need to deal with unexpanding
                //for (var i = 0; i < expandedPaths.length; i++) {
                //    promises.push($scope.treeApi.syncTree({ path: expandedPaths[i], activate: false, forceReload: true }));
                //}
                //execute them sequentially
                // set selected language to active
                angular.forEach($scope.languages, function (language) {
                    language.active = false;
                });
                language.active = true;
                angularHelper.executeSequentialPromises(promises);
            });
        };
        //this reacts to the options item in the tree
        //TODO: migrate to nav service
        //TODO: is this used?
        $scope.searchShowMenu = function (ev, args) {
            //always skip default
            args.skipDefault = true;
            navigationService.showMenu(args);
        };
        //TODO: migrate to nav service
        //TODO: is this used?
        $scope.searchHide = function () {
            navigationService.hideSearch();
        };
        //the below assists with hiding/showing the tree
        var treeActive = false;
        //Sets a service variable as soon as the user hovers the navigation with the mouse
        //used by the leaveTree method to delay hiding
        $scope.enterTree = function (event) {
            treeActive = true;
        };
        // Hides navigation tree, with a short delay, is cancelled if the user moves the mouse over the tree again
        $scope.leaveTree = function (event) {
            //this is a hack to handle IE touch events which freaks out due to no mouse events so the tree instantly shuts down
            if (!event) {
                return;
            }
            if (!appState.getGlobalState('touchDevice')) {
                treeActive = false;
                $timeout(function () {
                    if (!treeActive) {
                        navigationService.hideTree();
                    }
                }, 300);
            }
        };
        $scope.toggleLanguageSelector = function () {
            $scope.page.languageSelectorIsOpen = !$scope.page.languageSelectorIsOpen;
        };
        //ensure to unregister from all events!
        $scope.$on('$destroy', function () {
            for (var e in evts) {
                eventsService.unsubscribe(evts[e]);
            }
        });
    }
    //register it
    angular.module('umbraco').controller('Umbraco.NavigationController', NavigationController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.MainController
 * @function
 * 
 * @description
 * The controller for the AuthorizeUpgrade login page
 * 
 */
    function AuthorizeUpgradeController($scope, $window) {
        $scope.loginAndRedirect = function (event) {
            var qry = $window.location.search.trimStart('?').split('&');
            var redir = _.find(qry, function (item) {
                return item.startsWith('redir=');
            });
            if (redir) {
                $window.location = decodeURIComponent(redir.split('=')[1]);
            } else {
                $window.location = '/';
            }
        };
    }
    angular.module('umbraco').controller('Umbraco.AuthorizeUpgradeController', AuthorizeUpgradeController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.DashboardController
 * @function
 * 
 * @description
 * Controls the dashboards of the application
 * 
 */
    function DashboardController($scope, $routeParams, dashboardResource, localizationService) {
        $scope.page = {};
        $scope.page.nameLocked = true;
        $scope.page.loading = true;
        $scope.dashboard = {};
        localizationService.localize('sections_' + $routeParams.section).then(function (name) {
            $scope.dashboard.name = name;
        });
        dashboardResource.getDashboard($routeParams.section).then(function (tabs) {
            $scope.dashboard.tabs = tabs;
            // set first tab to active
            if ($scope.dashboard.tabs && $scope.dashboard.tabs.length > 0) {
                $scope.dashboard.tabs[0].active = true;
            }
            $scope.page.loading = false;
        });
        $scope.changeTab = function (tab) {
            $scope.dashboard.tabs.forEach(function (tab) {
                tab.active = false;
            });
            tab.active = true;
        };
    }
    //register it
    angular.module('umbraco').controller('Umbraco.DashboardController', DashboardController);
    'use strict';
    (function () {
        'use strict';
        function HelpDrawerController($scope, $routeParams, $timeout, dashboardResource, localizationService, userService, eventsService, helpService, appState, tourService, $filter) {
            var vm = this;
            var evts = [];
            vm.title = '';
            vm.subtitle = 'Umbraco version' + ' ' + Umbraco.Sys.ServerVariables.application.version;
            vm.section = $routeParams.section;
            vm.tree = $routeParams.tree;
            vm.sectionName = '';
            vm.customDashboard = null;
            vm.tours = [];
            vm.closeDrawer = closeDrawer;
            vm.startTour = startTour;
            vm.getTourGroupCompletedPercentage = getTourGroupCompletedPercentage;
            vm.showTourButton = showTourButton;
            function startTour(tour) {
                tourService.startTour(tour);
                closeDrawer();
            }
            function oninit() {
                // set title
                localizationService.localize('general_help').then(function (data) {
                    vm.title = data;
                });
                tourService.getGroupedTours().then(function (groupedTours) {
                    vm.tours = groupedTours;
                    getTourGroupCompletedPercentage();
                });
                // load custom help dashboard
                dashboardResource.getDashboard('user-help').then(function (dashboard) {
                    vm.customDashboard = dashboard;
                });
                if (!vm.section) {
                    vm.section = 'content';
                }
                setSectionName();
                userService.getCurrentUser().then(function (user) {
                    vm.userType = user.userType;
                    vm.userLang = user.locale;
                    vm.hasAccessToSettings = _.contains(user.allowedSections, 'settings');
                    evts.push(eventsService.on('appState.treeState.changed', function (e, args) {
                        handleSectionChange();
                    }));
                    findHelp(vm.section, vm.tree, vm.userType, vm.userLang);
                });
                // check if a tour is running - if it is open the matching group
                var currentTour = tourService.getCurrentTour();
                if (currentTour) {
                    openTourGroup(currentTour.alias);
                }
            }
            function closeDrawer() {
                appState.setDrawerState('showDrawer', false);
            }
            function handleSectionChange() {
                $timeout(function () {
                    if (vm.section !== $routeParams.section || vm.tree !== $routeParams.tree) {
                        vm.section = $routeParams.section;
                        vm.tree = $routeParams.tree;
                        setSectionName();
                        findHelp(vm.section, vm.tree, vm.userType, vm.userLang);
                    }
                });
            }
            function findHelp(section, tree, usertype, userLang) {
                if (vm.hasAccessToSettings) {
                    helpService.getContextHelpForPage(section, tree).then(function (topics) {
                        vm.topics = topics;
                    });
                }
                var rq = {};
                rq.section = vm.section;
                rq.usertype = usertype;
                rq.lang = userLang;
                if ($routeParams.url) {
                    rq.path = decodeURIComponent($routeParams.url);
                    if (rq.path.indexOf(Umbraco.Sys.ServerVariables.umbracoSettings.umbracoPath) === 0) {
                        rq.path = rq.path.substring(Umbraco.Sys.ServerVariables.umbracoSettings.umbracoPath.length);
                    }
                    if (rq.path.indexOf('.aspx') > 0) {
                        rq.path = rq.path.substring(0, rq.path.indexOf('.aspx'));
                    }
                } else {
                    rq.path = rq.section + '/' + $routeParams.tree + '/' + $routeParams.method;
                }
                if (vm.hasAccessToSettings) {
                    helpService.findVideos(rq).then(function (videos) {
                        vm.videos = videos;
                    });
                }
            }
            function setSectionName() {
                // Get section name
                var languageKey = 'sections_' + vm.section;
                localizationService.localize(languageKey).then(function (value) {
                    vm.sectionName = value;
                });
            }
            function showTourButton(index, tourGroup) {
                if (index !== 0) {
                    var prevTour = tourGroup.tours[index - 1];
                    if (prevTour.completed) {
                        return true;
                    }
                } else {
                    return true;
                }
            }
            function openTourGroup(tourAlias) {
                angular.forEach(vm.tours, function (group) {
                    angular.forEach(group, function (tour) {
                        if (tour.alias === tourAlias) {
                            group.open = true;
                        }
                    });
                });
            }
            function getTourGroupCompletedPercentage() {
                // Finding out, how many tours are completed for the progress circle
                angular.forEach(vm.tours, function (group) {
                    var completedTours = 0;
                    angular.forEach(group.tours, function (tour) {
                        if (tour.completed) {
                            completedTours++;
                        }
                    });
                    group.completedPercentage = Math.round(completedTours / group.tours.length * 100);
                });
            }
            evts.push(eventsService.on('appState.tour.complete', function (event, tour) {
                tourService.getGroupedTours().then(function (groupedTours) {
                    vm.tours = groupedTours;
                    openTourGroup(tour.alias);
                    getTourGroupCompletedPercentage();
                });
            }));
            $scope.$on('$destroy', function () {
                for (var e in evts) {
                    eventsService.unsubscribe(evts[e]);
                }
            });
            oninit();
        }
        angular.module('umbraco').controller('Umbraco.Drawers.Help', HelpDrawerController);
    }());
    'use strict';
    (function () {
        'use strict';
        function CompositionsController($scope, $location, $filter) {
            var vm = this;
            var oldModel = null;
            vm.showConfirmSubmit = false;
            vm.isSelected = isSelected;
            vm.openContentType = openContentType;
            vm.submit = submit;
            vm.close = close;
            function onInit() {
                /* make a copy of the init model so it is possible to roll 
      back the changes on cancel */
                oldModel = angular.copy($scope.model);
                if (!$scope.model.title) {
                    $scope.model.title = 'Compositions';
                }
                // group the content types by their container paths
                vm.availableGroups = $filter('orderBy')(_.map(_.groupBy($scope.model.availableCompositeContentTypes, function (compositeContentType) {
                    return compositeContentType.contentType.metaData.containerPath;
                }), function (group) {
                    return {
                        containerPath: group[0].contentType.metaData.containerPath,
                        compositeContentTypes: group
                    };
                }), function (group) {
                    return group.containerPath.replace(/\//g, ' ');
                });
            }
            function isSelected(alias) {
                if ($scope.model.contentType.compositeContentTypes.indexOf(alias) !== -1) {
                    return true;
                }
            }
            function openContentType(contentType, section) {
                var url = (section === 'documentType' ? '/settings/documenttypes/edit/' : '/settings/mediaTypes/edit/') + contentType.id;
                $location.path(url);
            }
            function submit() {
                if ($scope.model && $scope.model.submit) {
                    // check if any compositions has been removed
                    vm.compositionRemoved = false;
                    for (var i = 0; oldModel.compositeContentTypes.length > i; i++) {
                        var oldComposition = oldModel.compositeContentTypes[i];
                        if (_.contains($scope.model.compositeContentTypes, oldComposition) === false) {
                            vm.compositionRemoved = true;
                        }
                    }
                    /* submit the form if there havne't been removed any composition
        or the confirm checkbox has been checked */
                    if (!vm.compositionRemoved || vm.allowSubmit) {
                        $scope.model.submit($scope.model);
                    }
                }
            }
            function close() {
                if ($scope.model && $scope.model.close) {
                    $scope.model.close(oldModel);
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.CompositionsController', CompositionsController);
    }());
    'use strict';
    (function () {
        'use strict';
        function CopyController($scope, localizationService, eventsService, entityHelper) {
            var vm = this;
            vm.hideSearch = hideSearch;
            vm.selectResult = selectResult;
            vm.onSearchResults = onSearchResults;
            vm.submit = submit;
            vm.close = close;
            var dialogOptions = $scope.model;
            var searchText = 'Search...';
            var node = dialogOptions.currentNode;
            $scope.model.relateToOriginal = true;
            $scope.dialogTreeApi = {};
            vm.searchInfo = {
                searchFromId: null,
                searchFromName: null,
                showSearch: false,
                results: [],
                selectedSearchResults: []
            };
            // get entity type based on the section
            $scope.entityType = entityHelper.getEntityTypeFromSection(dialogOptions.section);
            function onInit() {
                if (!$scope.model.title) {
                    localizationService.localize('general_copy').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                localizationService.localize('general_search').then(function (value) {
                    searchText = value + '...';
                });
            }
            function nodeSelectHandler(args) {
                if (args && args.event) {
                    args.event.preventDefault();
                    args.event.stopPropagation();
                }
                //eventsService.emit("editors.content.copyController.select", args);
                if ($scope.model.target) {
                    //un-select if there's a current one selected
                    $scope.model.target.selected = false;
                }
                $scope.model.target = args.node;
                $scope.model.target.selected = true;
            }
            function nodeExpandedHandler(args) {
                // open mini list view for list views
                if (args.node.metaData.isContainer) {
                    openMiniListView(args.node);
                }
            }
            function hideSearch() {
                vm.searchInfo.showSearch = false;
                vm.searchInfo.searchFromId = null;
                vm.searchInfo.searchFromName = null;
                vm.searchInfo.results = [];
            }
            // method to select a search result
            function selectResult(evt, result) {
                result.selected = result.selected === true ? false : true;
                nodeSelectHandler(evt, {
                    event: evt,
                    node: result
                });
            }
            //callback when there are search results
            function onSearchResults(results) {
                vm.searchInfo.results = results;
                vm.searchInfo.showSearch = true;
            }
            $scope.onTreeInit = function () {
                $scope.dialogTreeApi.callbacks.treeNodeSelect(nodeSelectHandler);
                $scope.dialogTreeApi.callbacks.treeNodeExpanded(nodeExpandedHandler);
            };
            // Mini list view
            $scope.selectListViewNode = function (node) {
                node.selected = node.selected === true ? false : true;
                nodeSelectHandler({}, { node: node });
            };
            $scope.closeMiniListView = function () {
                $scope.miniListView = undefined;
            };
            function openMiniListView(node) {
                $scope.miniListView = node;
            }
            function submit() {
                if ($scope.model && $scope.model.submit) {
                    $scope.model.submit($scope.model);
                }
            }
            function close() {
                if ($scope.model && $scope.model.close) {
                    $scope.model.close();
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.CopyController', CopyController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.DataTypePickerController
 * @function
 *
 * @description
 * The controller for the content type editor data type picker dialog
 */
    (function () {
        'use strict';
        function DataTypePicker($scope, dataTypeResource, dataTypeHelper, contentTypeResource, localizationService, editorService) {
            var vm = this;
            vm.searchTerm = '';
            vm.showTabs = false;
            vm.tabsLoaded = 0;
            vm.typesAndEditors = [];
            vm.userConfigured = [];
            vm.loading = false;
            vm.tabs = [];
            vm.labels = {};
            vm.onTabChange = onTabChange;
            vm.filterItems = filterItems;
            vm.showDetailsOverlay = showDetailsOverlay;
            vm.hideDetailsOverlay = hideDetailsOverlay;
            vm.pickEditor = pickEditor;
            vm.pickDataType = pickDataType;
            vm.close = close;
            function activate() {
                setTitle();
                loadTabs();
                getGroupedDataTypes();
                getGroupedPropertyEditors();
            }
            function setTitle() {
                if (!$scope.model.title) {
                    localizationService.localize('defaultdialogs_selectEditor').then(function (data) {
                        $scope.model.title = data;
                    });
                }
            }
            function loadTabs() {
                var labels = [
                    'contentTypeEditor_availableEditors',
                    'contentTypeEditor_reuse'
                ];
                localizationService.localizeMany(labels).then(function (data) {
                    vm.labels.availableDataTypes = data[0];
                    vm.labels.reuse = data[1];
                    vm.tabs = [
                        {
                            active: true,
                            id: 1,
                            label: vm.labels.availableDataTypes,
                            alias: 'Default',
                            typesAndEditors: []
                        },
                        {
                            active: false,
                            id: 2,
                            label: vm.labels.reuse,
                            alias: 'Reuse',
                            userConfigured: []
                        }
                    ];
                });
            }
            function getGroupedPropertyEditors() {
                vm.loading = true;
                dataTypeResource.getGroupedPropertyEditors().then(function (data) {
                    vm.tabs[0].typesAndEditors = data;
                    vm.typesAndEditors = data;
                    vm.tabsLoaded = vm.tabsLoaded + 1;
                    checkIfTabContentIsLoaded();
                });
            }
            function getGroupedDataTypes() {
                vm.loading = true;
                dataTypeResource.getGroupedDataTypes().then(function (data) {
                    vm.tabs[1].userConfigured = data;
                    vm.userConfigured = data;
                    vm.tabsLoaded = vm.tabsLoaded + 1;
                    checkIfTabContentIsLoaded();
                });
            }
            function checkIfTabContentIsLoaded() {
                if (vm.tabsLoaded === 2) {
                    vm.loading = false;
                    vm.showTabs = true;
                }
            }
            function onTabChange(selectedTab) {
                vm.tabs.forEach(function (tab) {
                    tab.active = false;
                });
                selectedTab.active = true;
            }
            function filterItems() {
                // clear item details
                $scope.model.itemDetails = null;
                if (vm.searchTerm) {
                    vm.showFilterResult = true;
                    vm.showTabs = false;
                } else {
                    vm.showFilterResult = false;
                    vm.showTabs = true;
                }
            }
            function showDetailsOverlay(property) {
                var propertyDetails = {};
                propertyDetails.icon = property.icon;
                propertyDetails.title = property.name;
                $scope.model.itemDetails = propertyDetails;
            }
            function hideDetailsOverlay() {
                $scope.model.itemDetails = null;
            }
            function pickEditor(propertyEditor) {
                var dataTypeSettings = {
                    propertyEditor: propertyEditor,
                    property: $scope.model.property,
                    contentTypeName: $scope.model.contentTypeName,
                    create: true,
                    view: 'views/common/infiniteeditors/datatypesettings/datatypesettings.html',
                    submit: function submit(model) {
                        contentTypeResource.getPropertyTypeScaffold(model.dataType.id).then(function (propertyType) {
                            _submit(model.dataType, propertyType, true);
                            editorService.close();
                        });
                    },
                    close: function close() {
                        editorService.close();
                    }
                };
                editorService.open(dataTypeSettings);
            }
            function pickDataType(selectedDataType) {
                selectedDataType.loading = true;
                dataTypeResource.getById(selectedDataType.id).then(function (dataType) {
                    contentTypeResource.getPropertyTypeScaffold(dataType.id).then(function (propertyType) {
                        selectedDataType.loading = false;
                        _submit(dataType, propertyType, false);
                    });
                });
            }
            function _submit(dataType, propertyType, isNew) {
                // update property
                $scope.model.property.config = propertyType.config;
                $scope.model.property.editor = propertyType.editor;
                $scope.model.property.view = propertyType.view;
                $scope.model.property.dataTypeId = dataType.id;
                $scope.model.property.dataTypeIcon = dataType.icon;
                $scope.model.property.dataTypeName = dataType.name;
                $scope.model.updateSameDataTypes = isNew;
                $scope.model.submit($scope.model);
            }
            function close() {
                if ($scope.model.close) {
                    $scope.model.close();
                }
            }
            activate();
        }
        angular.module('umbraco').controller('Umbraco.Editors.DataTypePickerController', DataTypePicker);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.DataTypeSettingsController
 * @function
 *
 * @description
 * The controller for the content type editor data type settings dialog
 */
    (function () {
        'use strict';
        function DataTypeSettingsController($scope, dataTypeResource, dataTypeHelper, localizationService) {
            var vm = this;
            vm.dataType = {};
            vm.loadingDataType = false;
            vm.saveButtonState = 'init';
            vm.close = close;
            vm.submit = submit;
            function onInit() {
                setTitle();
                if ($scope.model.create) {
                    createNewDataType();
                } else {
                    getDataType();
                }
            }
            function setTitle() {
                if (!$scope.model.title) {
                    localizationService.localize('contentTypeEditor_editorSettings').then(function (data) {
                        $scope.model.title = data;
                    });
                }
            }
            function createNewDataType() {
                vm.loadingDataType = true;
                var parentId = -1;
                var newDataType = {};
                dataTypeResource.getScaffold(parentId).then(function (dataType) {
                    newDataType = dataType;
                    // set alias
                    newDataType.selectedEditor = $scope.model.propertyEditor.alias;
                    // set name
                    var nameArray = [];
                    if ($scope.model.contentTypeName) {
                        nameArray.push($scope.model.contentTypeName);
                    }
                    if ($scope.model.property.label) {
                        nameArray.push($scope.model.property.label);
                    }
                    if ($scope.model.propertyEditor.name) {
                        nameArray.push($scope.model.propertyEditor.name);
                    }
                    // make name
                    newDataType.name = nameArray.join(' - ');
                    // get pre values
                    dataTypeResource.getPreValues(newDataType.selectedEditor).then(function (preValues) {
                        newDataType.preValues = preValues;
                        vm.dataType = newDataType;
                        vm.loadingDataType = false;
                    });
                });
            }
            function getDataType() {
                vm.loadingDataType = true;
                dataTypeResource.getById($scope.model.id).then(function (dataType) {
                    vm.dataType = dataType;
                    vm.loadingDataType = false;
                });
            }
            function close() {
                if ($scope.model && $scope.model.close) {
                    $scope.model.close();
                }
            }
            function submit() {
                vm.saveButtonState = 'busy';
                var preValues = dataTypeHelper.createPreValueProps(vm.dataType.preValues);
                dataTypeResource.save(vm.dataType, preValues, $scope.model.create).then(function (newDataType) {
                    $scope.model.dataType = newDataType;
                    vm.saveButtonState = 'success';
                    if ($scope.model && $scope.model.submit) {
                        $scope.model.submit($scope.model);
                    }
                });
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.DataTypeSettingsController', DataTypeSettingsController);
    }());
    'use strict';
    (function () {
        'use strict';
        function EmbedController($scope, $http, $sce, umbRequestHelper, localizationService) {
            var vm = this;
            var origWidth = 500;
            var origHeight = 300;
            vm.trustedPreview = null;
            $scope.model.embed = {
                url: '',
                width: 360,
                height: 240,
                constrain: true,
                preview: '',
                success: false,
                info: '',
                supportsDimensions: ''
            };
            vm.showPreview = showPreview;
            vm.changeSize = changeSize;
            vm.submit = submit;
            vm.close = close;
            function onInit() {
                if (!$scope.model.title) {
                    localizationService.localize('general_embed').then(function (value) {
                        $scope.model.title = value;
                    });
                }
            }
            function showPreview() {
                if ($scope.model.embed.url) {
                    $scope.model.embed.show = true;
                    $scope.model.embed.preview = '<div class="umb-loader" style="height: 10px; margin: 10px 0px;"></div>';
                    $scope.model.embed.info = '';
                    $scope.model.embed.success = false;
                    $http({
                        method: 'GET',
                        url: umbRequestHelper.getApiUrl('embedApiBaseUrl', 'GetEmbed'),
                        params: {
                            url: $scope.model.embed.url,
                            width: $scope.model.embed.width,
                            height: $scope.model.embed.height
                        }
                    }).then(function (response) {
                        $scope.model.embed.preview = '';
                        switch (response.data.Status) {
                        case 0:
                            //not supported
                            $scope.model.embed.info = 'Not supported';
                            break;
                        case 1:
                            //error
                            $scope.model.embed.info = 'Could not embed media - please ensure the URL is valid';
                            break;
                        case 2:
                            $scope.model.embed.preview = response.data.Markup;
                            vm.trustedPreview = $sce.trustAsHtml(response.data.Markup);
                            $scope.model.embed.supportsDimensions = response.data.SupportsDimensions;
                            $scope.model.embed.success = true;
                            break;
                        }
                    }, function () {
                        $scope.model.embed.supportsDimensions = false;
                        $scope.model.embed.preview = '';
                        $scope.model.embed.info = 'Could not embed media - please ensure the URL is valid';
                    });
                } else {
                    $scope.model.embed.supportsDimensions = false;
                    $scope.model.embed.preview = '';
                    $scope.model.embed.info = 'Please enter a URL';
                }
            }
            function changeSize(type) {
                var width, height;
                if ($scope.model.embed.constrain) {
                    width = parseInt($scope.model.embed.width, 10);
                    height = parseInt($scope.model.embed.height, 10);
                    if (type == 'width') {
                        origHeight = Math.round(width / origWidth * height);
                        $scope.model.embed.height = origHeight;
                    } else {
                        origWidth = Math.round(height / origHeight * width);
                        $scope.model.embed.width = origWidth;
                    }
                }
                if ($scope.model.embed.url !== '') {
                    showPreview();
                }
            }
            function submit() {
                if ($scope.model && $scope.model.submit) {
                    $scope.model.submit($scope.model);
                }
            }
            function close() {
                if ($scope.model && $scope.model.close) {
                    $scope.model.close();
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.EmbedController', EmbedController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.IconPickerController
 * @function
 *
 * @description
 * The controller for the content type editor icon picker
 */
    function IconPickerController($scope, iconHelper, localizationService) {
        var vm = this;
        vm.selectIcon = selectIcon;
        vm.close = close;
        vm.colors = [
            {
                name: 'Black',
                value: 'color-black'
            },
            {
                name: 'Blue Grey',
                value: 'color-blue-grey'
            },
            {
                name: 'Grey',
                value: 'color-grey'
            },
            {
                name: 'Brown',
                value: 'color-brown'
            },
            {
                name: 'Blue',
                value: 'color-blue'
            },
            {
                name: 'Light Blue',
                value: 'color-light-blue'
            },
            {
                name: 'Indigo',
                value: 'color-indigo'
            },
            {
                name: 'Purple',
                value: 'color-purple'
            },
            {
                name: 'Deep Purple',
                value: 'color-deep-purple'
            },
            {
                name: 'Cyan',
                value: 'color-cyan'
            },
            {
                name: 'Green',
                value: 'color-green'
            },
            {
                name: 'Light Green',
                value: 'color-light-green'
            },
            {
                name: 'Lime',
                value: 'color-lime'
            },
            {
                name: 'Yellow',
                value: 'color-yellow'
            },
            {
                name: 'Amber',
                value: 'color-amber'
            },
            {
                name: 'Orange',
                value: 'color-orange'
            },
            {
                name: 'Deep Orange',
                value: 'color-deep-orange'
            },
            {
                name: 'Red',
                value: 'color-red'
            },
            {
                name: 'Pink',
                value: 'color-pink'
            }
        ];
        function onInit() {
            vm.loading = true;
            setTitle();
            iconHelper.getIcons().then(function (icons) {
                vm.icons = icons;
                vm.loading = false;
            });
            // set a default color if nothing is passed in
            vm.color = $scope.model.color ? $scope.model.color : vm.colors[0].value;
            // if an icon is passed in - preselect it
            vm.icon = $scope.model.icon ? $scope.model.icon : undefined;
        }
        function setTitle() {
            if (!$scope.model.title) {
                localizationService.localize('defaultdialogs_selectIcon').then(function (data) {
                    $scope.model.title = data;
                });
            }
        }
        function selectIcon(icon, color) {
            $scope.model.icon = icon;
            $scope.model.color = color;
            submit();
        }
        function close() {
            if ($scope.model && $scope.model.close) {
                $scope.model.close();
            }
        }
        function submit() {
            if ($scope.model && $scope.model.submit) {
                $scope.model.submit($scope.model);
            }
        }
        onInit();
    }
    angular.module('umbraco').controller('Umbraco.Editors.IconPickerController', IconPickerController);
    'use strict';
    (function () {
        'use strict';
        function InsertOverlayController($scope, localizationService, editorService) {
            var vm = this;
            vm.openMacroPicker = openMacroPicker;
            vm.openPageFieldOverlay = openPageFieldOverlay;
            vm.openDictionaryItemOverlay = openDictionaryItemOverlay;
            vm.openPartialOverlay = openPartialOverlay;
            vm.close = close;
            function onInit() {
                if (!$scope.model.title) {
                    localizationService.localize('template_insert').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                if (!$scope.model.subtitle) {
                    localizationService.localize('template_insertDesc').then(function (value) {
                        $scope.model.subtitle = value;
                    });
                }
            }
            function openMacroPicker() {
                var macroPicker = {
                    dialogData: {},
                    submit: function submit(model) {
                        $scope.model.insert = {
                            'type': 'macro',
                            'macroParams': model.macroParams,
                            'selectedMacro': model.selectedMacro
                        };
                        $scope.model.submit($scope.model);
                        editorService.close();
                    },
                    close: function close() {
                        editorService.close();
                    }
                };
                editorService.macroPicker(macroPicker);
            }
            function openPageFieldOverlay() {
                var insertFieldEditor = {
                    submit: function submit(model) {
                        $scope.model.insert = {
                            'type': 'umbracoField',
                            'umbracoField': model.umbracoField
                        };
                        $scope.model.submit($scope.model);
                        editorService.close();
                    },
                    close: function close(model) {
                        editorService.close();
                    }
                };
                editorService.insertField(insertFieldEditor);
            }
            function openDictionaryItemOverlay() {
                var labelKeys = [
                    'template_insertDictionaryItem',
                    'template_insertDictionaryItemDesc',
                    'emptyStates_emptyDictionaryTree'
                ];
                localizationService.localizeMany(labelKeys).then(function (values) {
                    var title = values[0];
                    var subtitle = values[1];
                    var emptyStateMessage = values[2];
                    var dictionaryItemPicker = {
                        section: 'translation',
                        treeAlias: 'dictionary',
                        entityType: 'dictionary',
                        multiPicker: false,
                        title: title,
                        subtitle: subtitle,
                        emptyStateMessage: emptyStateMessage,
                        select: function select(node) {
                            $scope.model.insert = {
                                'type': 'dictionary',
                                'node': node
                            };
                            $scope.model.submit($scope.model);
                            editorService.close();
                        },
                        close: function close() {
                            editorService.close();
                        }
                    };
                    editorService.treePicker(dictionaryItemPicker);
                });
            }
            function openPartialOverlay() {
                localizationService.localize('template_insertPartialView').then(function (value) {
                    var title = value;
                    var partialItemPicker = {
                        section: 'settings',
                        treeAlias: 'partialViews',
                        entityType: 'partialView',
                        multiPicker: false,
                        title: title,
                        filter: function filter(i) {
                            if (i.name.indexOf('.cshtml') === -1 && i.name.indexOf('.vbhtml') === -1) {
                                return true;
                            }
                        },
                        filterCssClass: 'not-allowed',
                        select: function select(node) {
                            $scope.model.insert = {
                                'type': 'partial',
                                'node': node
                            };
                            $scope.model.submit($scope.model);
                            editorService.close();
                        },
                        close: function close() {
                            editorService.close();
                        }
                    };
                    editorService.treePicker(partialItemPicker);
                });
            }
            function close() {
                if ($scope.model.close) {
                    $scope.model.close();
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.InsertOverlay', InsertOverlayController);
    }());
    'use strict';
    (function () {
        'use strict';
        function InsertFieldController($scope, contentTypeResource, localizationService) {
            var vm = this;
            vm.field;
            vm.altField;
            vm.altText;
            vm.insertBefore;
            vm.insertAfter;
            vm.recursive = false;
            vm.properties = [];
            vm.standardFields = [];
            vm.date = false;
            vm.dateTime = false;
            vm.dateTimeSeparator = '';
            vm.casingUpper = false;
            vm.casingLower = false;
            vm.encodeHtml = false;
            vm.encodeUrl = false;
            vm.convertLinebreaks = false;
            vm.showAltField = false;
            vm.showAltText = false;
            vm.setDateOption = setDateOption;
            vm.setCasingOption = setCasingOption;
            vm.setEncodingOption = setEncodingOption;
            vm.generateOutputSample = generateOutputSample;
            vm.submit = submit;
            vm.close = close;
            function onInit() {
                // set default title
                if (!$scope.model.title) {
                    localizationService.localize('template_insertPageField').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                // Load all fields
                contentTypeResource.getAllPropertyTypeAliases().then(function (array) {
                    vm.properties = array;
                });
                // Load all standard fields
                contentTypeResource.getAllStandardFields().then(function (array) {
                    vm.standardFields = array;
                });
            }
            // date formatting
            function setDateOption(option) {
                if (option === 'date') {
                    if (vm.date) {
                        vm.date = false;
                    } else {
                        vm.date = true;
                        vm.dateTime = false;
                    }
                }
                if (option === 'dateWithTime') {
                    if (vm.dateTime) {
                        vm.dateTime = false;
                    } else {
                        vm.date = false;
                        vm.dateTime = true;
                    }
                }
            }
            // casing formatting
            function setCasingOption(option) {
                if (option === 'uppercase') {
                    if (vm.casingUpper) {
                        vm.casingUpper = false;
                    } else {
                        vm.casingUpper = true;
                        vm.casingLower = false;
                    }
                }
                if (option === 'lowercase') {
                    if (vm.casingLower) {
                        vm.casingLower = false;
                    } else {
                        vm.casingUpper = false;
                        vm.casingLower = true;
                    }
                }
            }
            // encoding formatting
            function setEncodingOption(option) {
                if (option === 'html') {
                    if (vm.encodeHtml) {
                        vm.encodeHtml = false;
                    } else {
                        vm.encodeHtml = true;
                        vm.encodeUrl = false;
                    }
                }
                if (option === 'url') {
                    if (vm.encodeUrl) {
                        vm.encodeUrl = false;
                    } else {
                        vm.encodeHtml = false;
                        vm.encodeUrl = true;
                    }
                }
            }
            function generateOutputSample() {
                var pageField = (vm.field !== undefined ? '@Umbraco.Field("' + vm.field + '"' : '') + (vm.altField !== undefined ? ', altFieldAlias:"' + vm.altField + '"' : '') + (vm.altText !== undefined ? ', altText:"' + vm.altText + '"' : '') + (vm.insertBefore !== undefined ? ', insertBefore:"' + vm.insertBefore + '"' : '') + (vm.insertAfter !== undefined ? ', insertAfter:"' + vm.insertAfter + '"' : '') + (vm.recursive !== false ? ', recursive: ' + vm.recursive : '') + (vm.date !== false ? ', formatAsDate: ' + vm.date : '') + (vm.dateTime !== false ? ', formatAsDateWithTimeSeparator:"' + vm.dateTimeSeparator + '"' : '') + (vm.casingUpper !== false ? ', casing: ' + 'RenderFieldCaseType.Upper' : '') + (vm.casingLower !== false ? ', casing: ' + 'RenderFieldCaseType.Lower' : '') + (vm.encodeHtml !== false ? ', encoding: ' + 'RenderFieldEncodingType.Html' : '') + (vm.encodeUrl !== false ? ', encoding: ' + 'RenderFieldEncodingType.Url' : '') + (vm.convertLinebreaks !== false ? ', convertLineBreaks: ' + 'true' : '') + (vm.field ? ')' : '');
                $scope.model.umbracoField = pageField;
                return pageField;
            }
            function submit(model) {
                if ($scope.model.submit) {
                    $scope.model.submit(model);
                }
            }
            function close() {
                if ($scope.model.close) {
                    $scope.model.close();
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.InsertFieldController', InsertFieldController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.ItemPickerController
 * @function
 *
 * @description
 * The controller for a reusable editor to pick items
 */
    function ItemPickerController($scope, localizationService) {
        var vm = this;
        vm.selectItem = selectItem;
        vm.submit = submit;
        vm.close = close;
        function onInit() {
            if (!$scope.model.title) {
                localizationService.localize('defaultdialogs_selectItem').then(function (value) {
                    $scope.model.title = value;
                });
            }
        }
        function selectItem(item) {
            $scope.model.selectedItem = item;
            submit($scope.model);
        }
        ;
        function submit(model) {
            if ($scope.model.submit) {
                $scope.model.submit(model);
            }
        }
        function close() {
            if ($scope.model.close) {
                $scope.model.close();
            }
        }
        onInit();
    }
    angular.module('umbraco').controller('Umbraco.Editors.ItemPicker', ItemPickerController);
    'use strict';
    //used for the media picker dialog
    angular.module('umbraco').controller('Umbraco.Editors.LinkPickerController', function ($scope, eventsService, entityResource, contentResource, mediaHelper, userService, localizationService, tinyMceService, editorService) {
        var vm = this;
        var dialogOptions = $scope.model;
        var searchText = 'Search...';
        vm.submit = submit;
        vm.close = close;
        localizationService.localize('general_search').then(function (value) {
            searchText = value + '...';
        });
        if (!$scope.model.title) {
            localizationService.localize('defaultdialogs_selectLink').then(function (value) {
                $scope.model.title = value;
            });
        }
        $scope.dialogTreeApi = {};
        $scope.model.target = {};
        $scope.searchInfo = {
            searchFromId: null,
            searchFromName: null,
            showSearch: false,
            results: [],
            selectedSearchResults: []
        };
        $scope.showTarget = $scope.model.hideTarget !== true;
        if (dialogOptions.currentTarget) {
            $scope.model.target = dialogOptions.currentTarget;
            //if we have a node ID, we fetch the current node to build the form data
            if ($scope.model.target.id || $scope.model.target.udi) {
                //will be either a udi or an int
                var id = $scope.model.target.udi ? $scope.model.target.udi : $scope.model.target.id;
                if (!$scope.model.target.path) {
                    entityResource.getPath(id, 'Document').then(function (path) {
                        $scope.model.target.path = path;
                        //now sync the tree to this path
                        $scope.dialogTreeApi.syncTree({
                            path: $scope.model.target.path,
                            tree: 'content'
                        });
                    });
                }
                // if a link exists, get the properties to build the anchor name list
                contentResource.getById(id).then(function (resp) {
                    $scope.anchorValues = tinyMceService.getAnchorNames(JSON.stringify(resp.properties));
                    $scope.model.target.url = resp.urls[0];
                });
            } else if ($scope.model.target.url.length) {
                // a url but no id/udi indicates an external link - trim the url to remove the anchor/qs
                // only do the substring if there's a # or a ?
                var indexOfAnchor = $scope.model.target.url.search(/(#|\?)/);
                if (indexOfAnchor > -1) {
                    // populate the anchor
                    $scope.model.target.anchor = $scope.model.target.url.substring(indexOfAnchor);
                    // then rewrite the model and populate the link
                    $scope.model.target.url = $scope.model.target.url.substring(0, indexOfAnchor);
                }
            }
        } else if (dialogOptions.anchors) {
            $scope.anchorValues = dialogOptions.anchors;
        }
        function nodeSelectHandler(args) {
            if (args && args.event) {
                args.event.preventDefault();
                args.event.stopPropagation();
            }
            eventsService.emit('dialogs.linkPicker.select', args);
            if ($scope.currentNode) {
                //un-select if there's a current one selected
                $scope.currentNode.selected = false;
            }
            $scope.currentNode = args.node;
            $scope.currentNode.selected = true;
            $scope.model.target.id = args.node.id;
            $scope.model.target.udi = args.node.udi;
            $scope.model.target.name = args.node.name;
            if (args.node.id < 0) {
                $scope.model.target.url = '/';
            } else {
                contentResource.getById(args.node.id).then(function (resp) {
                    $scope.anchorValues = tinyMceService.getAnchorNames(JSON.stringify(resp.properties));
                    $scope.model.target.url = resp.urls[0].text;
                });
            }
            if (!angular.isUndefined($scope.model.target.isMedia)) {
                delete $scope.model.target.isMedia;
            }
        }
        function nodeExpandedHandler(args) {
            // open mini list view for list views
            if (args.node.metaData.isContainer) {
                openMiniListView(args.node);
            }
        }
        $scope.switchToMediaPicker = function () {
            userService.getCurrentUser().then(function (userData) {
                var mediaPicker = {
                    startNodeId: userData.startMediaIds.length !== 1 ? -1 : userData.startMediaIds[0],
                    startNodeIsVirtual: userData.startMediaIds.length !== 1,
                    submit: function submit(model) {
                        var media = model.selectedImages[0];
                        $scope.model.target.id = media.id;
                        $scope.model.target.udi = media.udi;
                        $scope.model.target.isMedia = true;
                        $scope.model.target.name = media.name;
                        $scope.model.target.url = mediaHelper.resolveFile(media);
                        editorService.close();
                    },
                    close: function close() {
                        editorService.close();
                    }
                };
                editorService.mediaPicker(mediaPicker);
            });
        };
        $scope.hideSearch = function () {
            $scope.searchInfo.showSearch = false;
            $scope.searchInfo.searchFromId = null;
            $scope.searchInfo.searchFromName = null;
            $scope.searchInfo.results = [];
        };
        // method to select a search result
        $scope.selectResult = function (evt, result) {
            result.selected = result.selected === true ? false : true;
            nodeSelectHandler(evt, {
                event: evt,
                node: result
            });
        };
        //callback when there are search results
        $scope.onSearchResults = function (results) {
            $scope.searchInfo.results = results;
            $scope.searchInfo.showSearch = true;
        };
        $scope.onTreeInit = function () {
            $scope.dialogTreeApi.callbacks.treeNodeSelect(nodeSelectHandler);
            $scope.dialogTreeApi.callbacks.treeNodeExpanded(nodeExpandedHandler);
        };
        // Mini list view
        $scope.selectListViewNode = function (node) {
            node.selected = node.selected === true ? false : true;
            nodeSelectHandler({}, { node: node });
        };
        $scope.closeMiniListView = function () {
            $scope.miniListView = undefined;
        };
        function openMiniListView(node) {
            $scope.miniListView = node;
        }
        function close() {
            if ($scope.model && $scope.model.close) {
                $scope.model.close();
            }
        }
        function submit() {
            if ($scope.model && $scope.model.submit) {
                $scope.model.submit($scope.model);
            }
        }
    });
    'use strict';
    function MacroPickerController($scope, entityResource, macroResource, umbPropEditorHelper, macroService, formHelper, localizationService) {
        $scope.macros = [];
        $scope.model.selectedMacro = null;
        $scope.model.macroParams = [];
        $scope.wizardStep = 'macroSelect';
        $scope.noMacroParams = false;
        function onInit() {
            if (!$scope.model.title) {
                localizationService.localize('defaultdialogs_selectMacro').then(function (value) {
                    $scope.model.title = value;
                });
            }
        }
        $scope.selectMacro = function (macro) {
            $scope.model.selectedMacro = macro;
            if ($scope.wizardStep === 'macroSelect') {
                editParams(true);
            } else {
                $scope.model.submit($scope.model);
            }
        };
        $scope.close = function () {
            if ($scope.model.close) {
                $scope.model.close();
            }
        };
        /** changes the view to edit the params of the selected macro */
        /** if there is pnly one macro, and it has parameters - editor can skip selecting the Macro **/
        function editParams(insertIfNoParameters) {
            //whether to insert the macro in the rich text editor when editParams is called and there are no parameters see U4-10537 
            insertIfNoParameters = typeof insertIfNoParameters !== 'undefined' ? insertIfNoParameters : true;
            //get the macro params if there are any
            macroResource.getMacroParameters($scope.model.selectedMacro.id).then(function (data) {
                //go to next page if there are params otherwise we can just exit
                if (!angular.isArray(data) || data.length === 0) {
                    if (insertIfNoParameters) {
                        $scope.model.submit($scope.model);
                    } else {
                        $scope.wizardStep = 'macroSelect';
                    }
                } else {
                    $scope.wizardStep = 'paramSelect';
                    $scope.model.macroParams = data;
                    //fill in the data if we are editing this macro
                    if ($scope.model.dialogData && $scope.model.dialogData.macroData && $scope.model.dialogData.macroData.macroParamsDictionary) {
                        _.each($scope.model.dialogData.macroData.macroParamsDictionary, function (val, key) {
                            var prop = _.find($scope.model.macroParams, function (item) {
                                return item.alias == key;
                            });
                            if (prop) {
                                if (_.isString(val)) {
                                    //we need to unescape values as they have most likely been escaped while inserted
                                    val = _.unescape(val);
                                    //detect if it is a json string
                                    if (val.detectIsJson()) {
                                        try {
                                            //Parse it to json
                                            prop.value = angular.fromJson(val);
                                        } catch (e) {
                                            // not json
                                            prop.value = val;
                                        }
                                    } else {
                                        prop.value = val;
                                    }
                                } else {
                                    prop.value = val;
                                }
                            }
                        });
                    }
                }
            });
        }
        //here we check to see if we've been passed a selected macro and if so we'll set the
        //editor to start with parameter editing
        if ($scope.model.dialogData && $scope.model.dialogData.macroData) {
            $scope.wizardStep = 'paramSelect';
        }
        //get the macro list - pass in a filter if it is only for rte
        entityResource.getAll('Macro', $scope.model.dialogData && $scope.model.dialogData.richTextEditor && $scope.model.dialogData.richTextEditor === true ? 'UseInEditor=true' : null).then(function (data) {
            if (angular.isArray(data) && data.length == 0) {
                $scope.nomacros = true;
            }
            //if 'allowedMacros' is specified, we need to filter
            if (angular.isArray($scope.model.dialogData.allowedMacros) && $scope.model.dialogData.allowedMacros.length > 0) {
                $scope.macros = _.filter(data, function (d) {
                    return _.contains($scope.model.dialogData.allowedMacros, d.alias);
                });
            } else {
                $scope.macros = data;
            }
            //check if there's a pre-selected macro and if it exists
            if ($scope.model.dialogData && $scope.model.dialogData.macroData && $scope.model.dialogData.macroData.macroAlias) {
                var found = _.find(data, function (item) {
                    return item.alias === $scope.model.dialogData.macroData.macroAlias;
                });
                if (found) {
                    //select the macro and go to next screen
                    $scope.model.selectedMacro = found;
                    editParams(true);
                    return;
                }
            }
            //if there is only one macro in the site and it has parameters, let's not make the editor choose it from a selection of one macro (unless there are no parameters - then weirdly it's a better experience to make that selection)
            if ($scope.macros.length == 1) {
                $scope.model.selectedMacro = $scope.macros[0];
                editParams(false);
            } else {
                //we don't have a pre-selected macro so ensure the correct step is set
                $scope.wizardStep = 'macroSelect';
            }
        });
        onInit();
    }
    angular.module('umbraco').controller('Umbraco.Overlays.MacroPickerController', MacroPickerController);
    'use strict';
    //used for the media picker dialog
    angular.module('umbraco').controller('Umbraco.Editors.MediaPickerController', function ($scope, mediaResource, entityResource, mediaHelper, mediaTypeHelper, eventsService, treeService, localStorageService, localizationService, editorService) {
        if (!$scope.model.title) {
            localizationService.localizeMany([
                'defaultdialogs_selectMedia',
                'general_includeFromsubFolders'
            ]).then(function (data) {
                $scope.labels = {
                    title: data[0],
                    includeSubFolders: data[1]
                };
            });
        }
        var dialogOptions = $scope.model;
        $scope.disableFolderSelect = dialogOptions.disableFolderSelect;
        $scope.onlyImages = dialogOptions.onlyImages;
        $scope.showDetails = dialogOptions.showDetails;
        $scope.multiPicker = dialogOptions.multiPicker && dialogOptions.multiPicker !== '0' ? true : false;
        $scope.startNodeId = dialogOptions.startNodeId ? dialogOptions.startNodeId : -1;
        $scope.cropSize = dialogOptions.cropSize;
        $scope.lastOpenedNode = localStorageService.get('umbLastOpenedMediaNodeId');
        $scope.lockedFolder = true;
        $scope.allowMediaEdit = dialogOptions.allowMediaEdit ? dialogOptions.allowMediaEdit : false;
        var umbracoSettings = Umbraco.Sys.ServerVariables.umbracoSettings;
        var allowedUploadFiles = mediaHelper.formatFileTypes(umbracoSettings.allowedUploadFiles);
        if ($scope.onlyImages) {
            $scope.acceptedFileTypes = mediaHelper.formatFileTypes(umbracoSettings.imageFileTypes);
        } else {
            // Use whitelist of allowed file types if provided
            if (allowedUploadFiles !== '') {
                $scope.acceptedFileTypes = allowedUploadFiles;
            } else {
                // If no whitelist, we pass in a blacklist by adding ! to the file extensions, allowing everything EXCEPT for disallowedUploadFiles
                $scope.acceptedFileTypes = !mediaHelper.formatFileTypes(umbracoSettings.disallowedUploadFiles);
            }
        }
        $scope.maxFileSize = umbracoSettings.maxFileSize + 'KB';
        $scope.model.selectedImages = [];
        $scope.acceptedMediatypes = [];
        mediaTypeHelper.getAllowedImagetypes($scope.startNodeId).then(function (types) {
            $scope.acceptedMediatypes = types;
        });
        $scope.searchOptions = {
            pageNumber: 1,
            pageSize: 100,
            totalItems: 0,
            totalPages: 0,
            filter: ''
        };
        //preload selected item
        $scope.target = undefined;
        if (dialogOptions.currentTarget) {
            $scope.target = dialogOptions.currentTarget;
        }
        function onInit() {
            if ($scope.startNodeId !== -1) {
                entityResource.getById($scope.startNodeId, 'media').then(function (ent) {
                    $scope.startNodeId = ent.id;
                    run();
                });
            } else {
                run();
            }
        }
        function run() {
            //default root item
            if (!$scope.target) {
                if ($scope.lastOpenedNode && $scope.lastOpenedNode !== -1) {
                    entityResource.getById($scope.lastOpenedNode, 'media').then(ensureWithinStartNode, gotoStartNode);
                } else {
                    gotoStartNode();
                }
            } else {
                //if a target is specified, go look it up - generally this target will just contain ids not the actual full
                //media object so we need to look it up
                var id = $scope.target.udi ? $scope.target.udi : $scope.target.id;
                var altText = $scope.target.altText;
                mediaResource.getById(id).then(function (node) {
                    $scope.target = node;
                    if (ensureWithinStartNode(node)) {
                        selectImage(node);
                        $scope.target.url = mediaHelper.resolveFile(node);
                        $scope.target.altText = altText;
                        $scope.openDetailsDialog();
                    }
                }, gotoStartNode);
            }
        }
        $scope.upload = function (v) {
            angular.element('.umb-file-dropzone-directive .file-select').trigger('click');
        };
        $scope.dragLeave = function (el, event) {
            $scope.activeDrag = false;
        };
        $scope.dragEnter = function (el, event) {
            $scope.activeDrag = true;
        };
        $scope.submitFolder = function () {
            if ($scope.model.newFolderName) {
                $scope.creatingFolder = true;
                mediaResource.addFolder($scope.model.newFolderName, $scope.currentFolder.id).then(function (data) {
                    //we've added a new folder so lets clear the tree cache for that specific item
                    treeService.clearCache({
                        cacheKey: '__media',
                        //this is the main media tree cache key
                        childrenOf: data.parentId
                    });
                    $scope.creatingFolder = false;
                    $scope.gotoFolder(data);
                    $scope.showFolderInput = false;
                    $scope.model.newFolderName = '';
                });
            } else {
                $scope.showFolderInput = false;
            }
        };
        $scope.enterSubmitFolder = function (event) {
            if (event.keyCode === 13) {
                $scope.submitFolder();
                event.stopPropagation();
            }
        };
        $scope.gotoFolder = function (folder) {
            if (!$scope.multiPicker) {
                deselectAllImages($scope.model.selectedImages);
            }
            if (!folder) {
                folder = {
                    id: -1,
                    name: 'Media',
                    icon: 'icon-folder'
                };
            }
            if (folder.id > 0) {
                entityResource.getAncestors(folder.id, 'media').then(function (anc) {
                    $scope.path = _.filter(anc, function (f) {
                        return f.path.indexOf($scope.startNodeId) !== -1;
                    });
                });
                mediaTypeHelper.getAllowedImagetypes(folder.id).then(function (types) {
                    $scope.acceptedMediatypes = types;
                });
            } else {
                $scope.path = [];
            }
            $scope.lockedFolder = folder.id === -1 && $scope.model.startNodeIsVirtual;
            $scope.currentFolder = folder;
            localStorageService.set('umbLastOpenedMediaNodeId', folder.id);
            return getChildren(folder.id);
        };
        $scope.clickHandler = function (image, event, index) {
            if (image.isFolder) {
                if ($scope.disableFolderSelect) {
                    $scope.gotoFolder(image);
                } else {
                    eventsService.emit('dialogs.mediaPicker.select', image);
                    selectImage(image);
                }
            } else {
                eventsService.emit('dialogs.mediaPicker.select', image);
                if ($scope.showDetails) {
                    $scope.target = image;
                    // handle both entity and full media object
                    if (image.image) {
                        $scope.target.url = image.image;
                    } else {
                        $scope.target.url = mediaHelper.resolveFile(image);
                    }
                    $scope.openDetailsDialog();
                } else {
                    selectImage(image);
                }
            }
        };
        $scope.clickItemName = function (item) {
            if (item.isFolder) {
                $scope.gotoFolder(item);
            }
        };
        function selectImage(image) {
            if (image.selected) {
                for (var i = 0; $scope.model.selectedImages.length > i; i++) {
                    var imageInSelection = $scope.model.selectedImages[i];
                    if (image.key === imageInSelection.key) {
                        image.selected = false;
                        $scope.model.selectedImages.splice(i, 1);
                    }
                }
            } else {
                if (!$scope.multiPicker) {
                    deselectAllImages($scope.model.selectedImages);
                }
                image.selected = true;
                $scope.model.selectedImages.push(image);
            }
        }
        function deselectAllImages(images) {
            for (var i = 0; i < images.length; i++) {
                var image = images[i];
                image.selected = false;
            }
            images.length = 0;
        }
        $scope.onUploadComplete = function (files) {
            $scope.gotoFolder($scope.currentFolder).then(function () {
                if (files.length === 1 && $scope.model.selectedImages.length === 0) {
                    var image = $scope.images[$scope.images.length - 1];
                    $scope.target = image;
                    $scope.target.url = mediaHelper.resolveFile(image);
                    selectImage(image);
                }
            });
        };
        $scope.onFilesQueue = function () {
            $scope.activeDrag = false;
        };
        function ensureWithinStartNode(node) {
            // make sure that last opened node is on the same path as start node
            var nodePath = node.path.split(',');
            // also make sure the node is not trashed
            if (nodePath.indexOf($scope.startNodeId.toString()) !== -1 && node.trashed === false) {
                $scope.gotoFolder({
                    id: $scope.lastOpenedNode,
                    name: 'Media',
                    icon: 'icon-folder'
                });
                return true;
            } else {
                $scope.gotoFolder({
                    id: $scope.startNodeId,
                    name: 'Media',
                    icon: 'icon-folder'
                });
                return false;
            }
        }
        function gotoStartNode(err) {
            $scope.gotoFolder({
                id: $scope.startNodeId,
                name: 'Media',
                icon: 'icon-folder'
            });
        }
        $scope.openDetailsDialog = function () {
            $scope.mediaPickerDetailsOverlay = {};
            $scope.mediaPickerDetailsOverlay.show = true;
            $scope.mediaPickerDetailsOverlay.submit = function (model) {
                $scope.model.selectedImages.push($scope.target);
                $scope.model.submit($scope.model);
                $scope.mediaPickerDetailsOverlay.show = false;
                $scope.mediaPickerDetailsOverlay = null;
            };
            $scope.mediaPickerDetailsOverlay.close = function (oldModel) {
                $scope.mediaPickerDetailsOverlay.show = false;
                $scope.mediaPickerDetailsOverlay = null;
            };
        };
        var debounceSearchMedia = _.debounce(function () {
            $scope.$apply(function () {
                if ($scope.searchOptions.filter) {
                    searchMedia();
                } else {
                    // reset pagination
                    $scope.searchOptions = {
                        pageNumber: 1,
                        pageSize: 100,
                        totalItems: 0,
                        totalPages: 0,
                        filter: ''
                    };
                    getChildren($scope.currentFolder.id);
                }
            });
        }, 500);
        $scope.changeSearch = function () {
            $scope.loading = true;
            debounceSearchMedia();
        };
        $scope.toggle = function () {
            // Make sure to activate the changeSearch function everytime the toggle is clicked
            $scope.changeSearch();
        };
        $scope.changePagination = function (pageNumber) {
            $scope.loading = true;
            $scope.searchOptions.pageNumber = pageNumber;
            searchMedia();
        };
        function searchMedia() {
            $scope.loading = true;
            entityResource.getPagedDescendants($scope.currentFolder.id, 'Media', $scope.searchOptions).then(function (data) {
                // update image data to work with image grid
                angular.forEach(data.items, function (mediaItem) {
                    setMediaMetaData(mediaItem);
                });
                // update images
                $scope.images = data.items ? data.items : [];
                // update pagination
                if (data.pageNumber > 0)
                    $scope.searchOptions.pageNumber = data.pageNumber;
                if (data.pageSize > 0)
                    $scope.searchOptions.pageSize = data.pageSize;
                $scope.searchOptions.totalItems = data.totalItems;
                $scope.searchOptions.totalPages = data.totalPages;
                // set already selected images to selected
                preSelectImages();
                $scope.loading = false;
            });
        }
        function setMediaMetaData(mediaItem) {
            // set thumbnail and src
            mediaItem.thumbnail = mediaHelper.resolveFileFromEntity(mediaItem, true);
            mediaItem.image = mediaHelper.resolveFileFromEntity(mediaItem, false);
            // set properties to match a media object
            if (mediaItem.metaData && mediaItem.metaData.umbracoWidth && mediaItem.metaData.umbracoHeight) {
                mediaItem.properties = [
                    {
                        alias: 'umbracoWidth',
                        value: mediaItem.metaData.umbracoWidth.Value
                    },
                    {
                        alias: 'umbracoHeight',
                        value: mediaItem.metaData.umbracoHeight.Value
                    }
                ];
            }
        }
        function getChildren(id) {
            $scope.loading = true;
            return mediaResource.getChildren(id).then(function (data) {
                $scope.searchOptions.filter = '';
                $scope.images = data.items ? data.items : [];
                // set already selected images to selected
                preSelectImages();
                $scope.loading = false;
            });
        }
        function preSelectImages() {
            for (var folderImageIndex = 0; folderImageIndex < $scope.images.length; folderImageIndex++) {
                var folderImage = $scope.images[folderImageIndex];
                var imageIsSelected = false;
                if ($scope.model && angular.isArray($scope.model.selectedImages)) {
                    for (var selectedImageIndex = 0; selectedImageIndex < $scope.model.selectedImages.length; selectedImageIndex++) {
                        var selectedImage = $scope.model.selectedImages[selectedImageIndex];
                        if (folderImage.key === selectedImage.key) {
                            imageIsSelected = true;
                        }
                    }
                }
                if (imageIsSelected) {
                    folderImage.selected = true;
                }
            }
        }
        $scope.editMediaItem = function (item) {
            var mediaEditor = {
                id: item.id,
                submit: function submit(model) {
                    editorService.close();
                    // update the media picker item in the picker so it matched the saved media item
                    // the media picker is using media entities so we get the 
                    // entity so we easily can format it for use in the media grid
                    if (model && model.mediaNode) {
                        entityResource.getById(model.mediaNode.id, 'media').then(function (mediaEntity) {
                            angular.extend(item, mediaEntity);
                            setMediaMetaData(item);
                            setUpdatedMediaNodes(item);
                        });
                    }
                },
                close: function close(model) {
                    setUpdatedMediaNodes(item);
                    editorService.close();
                }
            };
            editorService.mediaEditor(mediaEditor);
        };
        function setUpdatedMediaNodes(item) {
            // add udi to list of updated media items so we easily can update them in other editors
            if ($scope.model.updatedMediaNodes.indexOf(item.udi) === -1) {
                $scope.model.updatedMediaNodes.push(item.udi);
            }
        }
        $scope.submit = function () {
            if ($scope.model.submit) {
                $scope.model.submit($scope.model);
            }
        };
        $scope.close = function () {
            if ($scope.model.close) {
                $scope.model.close($scope.model);
            }
        };
        onInit();
    });
    'use strict';
    //used for the member picker dialog
    angular.module('umbraco').controller('Umbraco.Editors.MemberGroupPickerController', function ($scope, eventsService, localizationService) {
        var vm = this;
        $scope.dialogTreeApi = {};
        $scope.multiPicker = $scope.model.multiPicker;
        vm.submit = submit;
        vm.close = close;
        function activate() {
            if (!$scope.model.title) {
                localizationService.localize('defaultdialogs_selectMemberGroup').then(function (value) {
                    $scope.model.title = value;
                });
            }
            if ($scope.multiPicker) {
                $scope.model.selectedMemberGroups = [];
            } else {
                $scope.model.selectedMemberGroup = '';
            }
        }
        function selectMemberGroup(id) {
            $scope.model.selectedMemberGroup = id;
        }
        function selectMemberGroups(id) {
            var index = $scope.model.selectedMemberGroups.indexOf(id);
            if (index === -1) {
                // If the id does not exists in the array then add it
                $scope.model.selectedMemberGroups.push(id);
            } else {
                // Otherwise we will remove it from the array instead
                $scope.model.selectedMemberGroups.splice(index, 1);
            }
        }
        /** Method used for selecting a node */
        function select(text, id) {
            if ($scope.model.multiPicker) {
                selectMemberGroups(id);
            } else {
                selectMemberGroup(id);
                $scope.model.submit($scope.model);
            }
        }
        function nodeSelectHandler(args) {
            args.event.preventDefault();
            args.event.stopPropagation();
            eventsService.emit('dialogs.memberGroupPicker.select', args);
            //This is a tree node, so we don't have an entity to pass in, it will need to be looked up
            //from the server in this method.
            select(args.node.name, args.node.id);
            //toggle checked state
            args.node.selected = args.node.selected === true ? false : true;
        }
        $scope.onTreeInit = function () {
            $scope.dialogTreeApi.callbacks.treeNodeSelect(nodeSelectHandler);
        };
        function close() {
            if ($scope.model && $scope.model.close) {
                $scope.model.close();
            }
        }
        function submit() {
            if ($scope.model && $scope.model.submit) {
                $scope.model.submit($scope.model);
            }
        }
        activate();
    });
    'use strict';
    (function () {
        'use strict';
        function MoveController($scope, localizationService, entityHelper) {
            var vm = this;
            vm.hideSearch = hideSearch;
            vm.selectResult = selectResult;
            vm.onSearchResults = onSearchResults;
            vm.submit = submit;
            vm.close = close;
            var dialogOptions = $scope.model;
            var searchText = 'Search...';
            var node = dialogOptions.currentNode;
            $scope.model.relateToOriginal = true;
            $scope.dialogTreeApi = {};
            vm.searchInfo = {
                searchFromId: null,
                searchFromName: null,
                showSearch: false,
                results: [],
                selectedSearchResults: []
            };
            // get entity type based on the section
            $scope.entityType = entityHelper.getEntityTypeFromSection(dialogOptions.section);
            function onInit() {
                if (!$scope.model.title) {
                    localizationService.localize('actions_move').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                localizationService.localize('general_search').then(function (value) {
                    searchText = value + '...';
                });
            }
            function nodeSelectHandler(args) {
                if (args && args.event) {
                    args.event.preventDefault();
                    args.event.stopPropagation();
                }
                //eventsService.emit("editors.content.copyController.select", args);
                if ($scope.model.target) {
                    //un-select if there's a current one selected
                    $scope.model.target.selected = false;
                }
                $scope.model.target = args.node;
                $scope.model.target.selected = true;
            }
            function nodeExpandedHandler(args) {
                // open mini list view for list views
                if (args.node.metaData.isContainer) {
                    openMiniListView(args.node);
                }
            }
            function hideSearch() {
                vm.searchInfo.showSearch = false;
                vm.searchInfo.searchFromId = null;
                vm.searchInfo.searchFromName = null;
                vm.searchInfo.results = [];
            }
            // method to select a search result
            function selectResult(evt, result) {
                result.selected = result.selected === true ? false : true;
                nodeSelectHandler(evt, {
                    event: evt,
                    node: result
                });
            }
            //callback when there are search results
            function onSearchResults(results) {
                vm.searchInfo.results = results;
                vm.searchInfo.showSearch = true;
            }
            $scope.onTreeInit = function () {
                $scope.dialogTreeApi.callbacks.treeNodeSelect(nodeSelectHandler);
                $scope.dialogTreeApi.callbacks.treeNodeExpanded(nodeExpandedHandler);
            };
            // Mini list view
            $scope.selectListViewNode = function (node) {
                node.selected = node.selected === true ? false : true;
                nodeSelectHandler({}, { node: node });
            };
            $scope.closeMiniListView = function () {
                $scope.miniListView = undefined;
            };
            function openMiniListView(node) {
                $scope.miniListView = node;
            }
            function submit() {
                if ($scope.model && $scope.model.submit) {
                    $scope.model.submit($scope.model);
                }
            }
            function close() {
                if ($scope.model && $scope.model.close) {
                    $scope.model.close();
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.MoveController', MoveController);
    }());
    'use strict';
    (function () {
        'use strict';
        function NodePermissionsController($scope, localizationService) {
            var vm = this;
            vm.submit = submit;
            vm.close = close;
            function onInit() {
                // set default title
                if (!$scope.model.title) {
                    localizationService.localize('defaultdialogs_permissionsEdit').then(function (value) {
                        $scope.model.title = value + ' ' + $scope.model.node.name;
                    });
                }
            }
            function submit() {
                if ($scope.model.submit) {
                    $scope.model.submit($scope.model);
                }
            }
            function close() {
                if ($scope.model.close) {
                    $scope.model.close();
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.NodePermissionsController', NodePermissionsController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.PropertySettingsController
 * @function
 *
 * @description
 * The controller for the content type editor property settings dialog
 */
    (function () {
        'use strict';
        function PropertySettingsEditor($scope, contentTypeResource, dataTypeResource, dataTypeHelper, formHelper, localizationService, userService, editorService) {
            var vm = this;
            vm.showValidationPattern = false;
            vm.focusOnPatternField = false;
            vm.focusOnMandatoryField = false;
            vm.selectedValidationType = null;
            vm.validationTypes = [];
            vm.labels = {};
            vm.changeValidationType = changeValidationType;
            vm.changeValidationPattern = changeValidationPattern;
            vm.openDataTypePicker = openDataTypePicker;
            vm.openDataTypeSettings = openDataTypeSettings;
            vm.submitOnEnter = submitOnEnter;
            vm.submit = submit;
            vm.close = close;
            function onInit() {
                userService.getCurrentUser().then(function (user) {
                    vm.showSensitiveData = user.userGroups.indexOf('sensitiveData') != -1;
                });
                //make the default the same as the content type            
                if (!$scope.model.property.dataTypeId) {
                    $scope.model.property.allowCultureVariant = $scope.model.contentTypeAllowCultureVariant;
                }
                loadValidationTypes();
            }
            function loadValidationTypes() {
                var labels = [
                    'validation_validateAsEmail',
                    'validation_validateAsNumber',
                    'validation_validateAsUrl',
                    'validation_enterCustomValidation'
                ];
                localizationService.localizeMany(labels).then(function (data) {
                    vm.labels.validateAsEmail = data[0];
                    vm.labels.validateAsNumber = data[1];
                    vm.labels.validateAsUrl = data[2];
                    vm.labels.customValidation = data[3];
                    vm.validationTypes = [
                        {
                            'name': vm.labels.validateAsEmail,
                            'key': 'email',
                            'pattern': '[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+.[a-zA-Z0-9-.]+',
                            'enableEditing': true
                        },
                        {
                            'name': vm.labels.validateAsNumber,
                            'key': 'number',
                            'pattern': '^[0-9]*$',
                            'enableEditing': true
                        },
                        {
                            'name': vm.labels.validateAsUrl,
                            'key': 'url',
                            'pattern': 'https?://[a-zA-Z0-9-.]+.[a-zA-Z]{2,}',
                            'enableEditing': true
                        },
                        {
                            'name': vm.labels.customValidation,
                            'key': 'custom',
                            'pattern': '',
                            'enableEditing': true
                        }
                    ];
                    matchValidationType();
                });
            }
            function changeValidationPattern() {
                matchValidationType();
            }
            function openDataTypePicker(property) {
                vm.focusOnMandatoryField = false;
                var dataTypePicker = {
                    property: $scope.model.property,
                    contentTypeName: $scope.model.contentTypeName,
                    view: 'views/common/infiniteeditors/datatypepicker/datatypepicker.html',
                    size: 'small',
                    submit: function submit(model) {
                        $scope.model.updateSameDataTypes = model.updateSameDataTypes;
                        vm.focusOnMandatoryField = true;
                        // update property
                        property.config = model.property.config;
                        property.editor = model.property.editor;
                        property.view = model.property.view;
                        property.dataTypeId = model.property.dataTypeId;
                        property.dataTypeIcon = model.property.dataTypeIcon;
                        property.dataTypeName = model.property.dataTypeName;
                        editorService.close();
                    },
                    close: function close(model) {
                        editorService.close();
                    }
                };
                editorService.open(dataTypePicker);
            }
            function openDataTypeSettings(property) {
                vm.focusOnMandatoryField = false;
                var dataTypeSettings = {
                    view: 'views/common/infiniteeditors/datatypesettings/datatypesettings.html',
                    id: property.dataTypeId,
                    submit: function submit(model) {
                        contentTypeResource.getPropertyTypeScaffold(model.dataType.id).then(function (propertyType) {
                            // update editor
                            property.config = propertyType.config;
                            property.editor = propertyType.editor;
                            property.view = propertyType.view;
                            property.dataTypeId = model.dataType.id;
                            property.dataTypeIcon = model.dataType.icon;
                            property.dataTypeName = model.dataType.name;
                            // set flag to update same data types
                            $scope.model.updateSameDataTypes = true;
                            vm.focusOnMandatoryField = true;
                            editorService.close();
                        });
                    },
                    close: function close() {
                        editorService.close();
                    }
                };
                editorService.open(dataTypeSettings);
            }
            function submitOnEnter(event) {
                if (event && event.keyCode === 13) {
                    submit();
                }
            }
            function submit() {
                if ($scope.model.submit) {
                    if (formHelper.submitForm({ scope: $scope })) {
                        $scope.model.submit($scope.model);
                    }
                }
            }
            function close() {
                if ($scope.model.close) {
                    $scope.model.close();
                }
            }
            function matchValidationType() {
                if ($scope.model.property.validation.pattern !== null && $scope.model.property.validation.pattern !== '' && $scope.model.property.validation.pattern !== undefined) {
                    var match = false;
                    // find and show if a match from the list has been chosen
                    angular.forEach(vm.validationTypes, function (validationType, index) {
                        if ($scope.model.property.validation.pattern === validationType.pattern) {
                            vm.selectedValidationType = vm.validationTypes[index];
                            vm.showValidationPattern = true;
                            match = true;
                        }
                    });
                    // if there is no match - choose the custom validation option.
                    if (!match) {
                        angular.forEach(vm.validationTypes, function (validationType) {
                            if (validationType.key === 'custom') {
                                vm.selectedValidationType = validationType;
                                vm.showValidationPattern = true;
                            }
                        });
                    }
                }
            }
            function changeValidationType(selectedValidationType) {
                if (selectedValidationType) {
                    $scope.model.property.validation.pattern = selectedValidationType.pattern;
                    vm.showValidationPattern = true;
                    // set focus on textarea
                    if (selectedValidationType.key === 'custom') {
                        vm.focusOnPatternField = true;
                    }
                } else {
                    $scope.model.property.validation.pattern = '';
                    vm.showValidationPattern = false;
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.PropertySettingsController', PropertySettingsEditor);
    }());
    'use strict';
    (function () {
        'use strict';
        function QueryBuilderOverlayController($scope, templateQueryResource, localizationService, editorService) {
            var everything = '';
            var myWebsite = '';
            var ascendingTranslation = '';
            var descendingTranslation = '';
            var vm = this;
            vm.properties = [];
            vm.contentTypes = [];
            vm.conditions = [];
            vm.datePickerConfig = { dateFormat: 'Y-m-d' };
            vm.chooseSource = chooseSource;
            vm.getPropertyOperators = getPropertyOperators;
            vm.addFilter = addFilter;
            vm.trashFilter = trashFilter;
            vm.changeSortOrder = changeSortOrder;
            vm.setSortProperty = setSortProperty;
            vm.setContentType = setContentType;
            vm.setFilterProperty = setFilterProperty;
            vm.setFilterTerm = setFilterTerm;
            vm.changeConstraintValue = changeConstraintValue;
            vm.datePickerChange = datePickerChange;
            vm.submit = submit;
            vm.close = close;
            function onInit() {
                if (!$scope.model.title) {
                    localizationService.localize('template_queryBuilder').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                vm.query = {
                    contentType: { name: everything },
                    source: { name: myWebsite },
                    filters: [{
                            property: undefined,
                            operator: undefined
                        }],
                    sort: {
                        property: {
                            alias: '',
                            name: ''
                        },
                        direction: 'ascending',
                        //This is the value for sorting sent to server
                        translation: {
                            currentLabel: ascendingTranslation,
                            //This is the localized UI value in the the dialog
                            ascending: ascendingTranslation,
                            descending: descendingTranslation
                        }
                    }
                };
                templateQueryResource.getAllowedProperties().then(function (properties) {
                    vm.properties = properties;
                });
                templateQueryResource.getContentTypes().then(function (contentTypes) {
                    vm.contentTypes = contentTypes;
                });
                templateQueryResource.getFilterConditions().then(function (conditions) {
                    vm.conditions = conditions;
                });
                throttledFunc();
            }
            function chooseSource(query) {
                var contentPicker = {
                    submit: function submit(model) {
                        var selectedNodeId = model.selection[0].id;
                        var selectedNodeName = model.selection[0].name;
                        if (selectedNodeId > 0) {
                            query.source = {
                                id: selectedNodeId,
                                name: selectedNodeName
                            };
                        } else {
                            query.source.name = myWebsite;
                            delete query.source.id;
                        }
                        throttledFunc();
                        editorService.close();
                    },
                    close: function close() {
                        editorService.close();
                    }
                };
                editorService.contentPicker(contentPicker);
            }
            function getPropertyOperators(property) {
                var conditions = _.filter(vm.conditions, function (condition) {
                    var index = condition.appliesTo.indexOf(property.type);
                    return index >= 0;
                });
                return conditions;
            }
            function addFilter(query) {
                query.filters.push({});
            }
            function trashFilter(query, filter) {
                for (var i = 0; i < query.filters.length; i++) {
                    if (query.filters[i] == filter) {
                        query.filters.splice(i, 1);
                    }
                }
                //if we remove the last one, add a new one to generate ui for it.
                if (query.filters.length == 0) {
                    query.filters.push({});
                }
            }
            function changeSortOrder(query) {
                if (query.sort.direction === 'ascending') {
                    query.sort.direction = 'descending';
                    query.sort.translation.currentLabel = query.sort.translation.descending;
                } else {
                    query.sort.direction = 'ascending';
                    query.sort.translation.currentLabel = query.sort.translation.ascending;
                }
                throttledFunc();
            }
            function setSortProperty(query, property) {
                query.sort.property = property;
                if (property.type === 'datetime') {
                    query.sort.direction = 'descending';
                    query.sort.translation.currentLabel = query.sort.translation.descending;
                } else {
                    query.sort.direction = 'ascending';
                    query.sort.translation.currentLabel = query.sort.translation.ascending;
                }
                throttledFunc();
            }
            function setContentType(contentType) {
                vm.query.contentType = contentType;
                throttledFunc();
            }
            function setFilterProperty(filter, property) {
                filter.property = property;
                filter.term = {};
                filter.constraintValue = '';
            }
            function setFilterTerm(filter, term) {
                filter.term = term;
                if (filter.constraintValue) {
                    throttledFunc();
                }
            }
            function changeConstraintValue() {
                throttledFunc();
            }
            function datePickerChange(date, filter) {
                var momentDate = moment(date);
                if (momentDate && momentDate.isValid()) {
                    filter.constraintValue = momentDate.format(vm.datePickerConfig.format);
                    throttledFunc();
                }
            }
            function submit(model) {
                if ($scope.model.submit) {
                    $scope.model.submit(model);
                }
            }
            function close() {
                if ($scope.model.close) {
                    $scope.model.close();
                }
            }
            var throttledFunc = _.throttle(function () {
                templateQueryResource.postTemplateQuery(vm.query).then(function (response) {
                    $scope.model.result = response;
                });
            }, 200);
            localizationService.localizeMany([
                'template_allContent',
                'template_websiteRoot',
                'template_ascending',
                'template_descending'
            ]).then(function (res) {
                everything = res[0];
                myWebsite = res[1];
                ascendingTranslation = res[2];
                descendingTranslation = res[3];
                onInit();
            });
        }
        angular.module('umbraco').controller('Umbraco.Editors.QueryBuilderController', QueryBuilderOverlayController);
    }());
    'use strict';
    (function () {
        'use strict';
        function RollbackController($scope, contentResource, localizationService, assetsService) {
            var vm = this;
            vm.rollback = rollback;
            vm.changeLanguage = changeLanguage;
            vm.changeVersion = changeVersion;
            vm.submit = submit;
            vm.close = close;
            //////////
            function onInit() {
                vm.loading = true;
                vm.variantVersions = [];
                vm.diff = null;
                vm.currentVersion = null;
                vm.rollbackButtonDisabled = true;
                // find the current version for invariant nodes
                if ($scope.model.node.variants.length === 1) {
                    vm.currentVersion = $scope.model.node.variants[0];
                }
                // find the current version for nodes with variants
                if ($scope.model.node.variants.length > 1) {
                    var active = _.find($scope.model.node.variants, function (v) {
                        return v.active;
                    });
                    // preselect the language in the dropdown
                    if (active) {
                        vm.selectedLanguage = active;
                        vm.currentVersion = active;
                    }
                }
                // set default title
                if (!$scope.model.title) {
                    localizationService.localize('actions_rollback').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                // Load in diff library
                assetsService.loadJs('lib/jsdiff/diff.min.js', $scope).then(function () {
                    getVersions().then(function () {
                        vm.loading = false;
                    });
                });
            }
            function changeLanguage(language) {
                vm.currentVersion = language;
                getVersions();
            }
            function changeVersion(version) {
                if (version && version.versionId) {
                    var culture = $scope.model.node.variants.length > 1 ? vm.currentVersion.language.culture : null;
                    contentResource.getRollbackVersion(version.versionId, culture).then(function (data) {
                        vm.previousVersion = data;
                        vm.previousVersion.versionId = version.versionId;
                        createDiff(vm.currentVersion, vm.previousVersion);
                        vm.rollbackButtonDisabled = false;
                    });
                } else {
                    vm.diff = null;
                    vm.rollbackButtonDisabled = true;
                }
            }
            function getVersions() {
                var nodeId = $scope.model.node.id;
                var culture = $scope.model.node.variants.length > 1 ? vm.currentVersion.language.culture : null;
                return contentResource.getRollbackVersions(nodeId, culture).then(function (data) {
                    vm.previousVersions = data.map(function (version) {
                        version.displayValue = version.versionDate + ' - ' + version.versionAuthorName;
                        return version;
                    });
                });
            }
            /**
     * This will load in a new version
     */
            function createDiff(currentVersion, previousVersion) {
                vm.diff = {};
                vm.diff.properties = [];
                // find diff in name
                vm.diff.name = JsDiff.diffWords(currentVersion.name, previousVersion.name);
                // extract all properties from the tabs and create new object for the diff
                currentVersion.tabs.forEach(function (tab, tabIndex) {
                    tab.properties.forEach(function (property, propertyIndex) {
                        var oldProperty = previousVersion.tabs[tabIndex].properties[propertyIndex];
                        // we have to make properties storing values as object into strings (Grid, nested content, etc.)
                        if (property.value instanceof Object) {
                            property.value = JSON.stringify(property.value, null, 1);
                            property.isObject = true;
                        }
                        if (oldProperty.value instanceof Object) {
                            oldProperty.value = JSON.stringify(oldProperty.value, null, 1);
                            oldProperty.isObject = true;
                        }
                        // diff requires a string
                        property.value = property.value ? property.value : '';
                        oldProperty.value = oldProperty.value ? oldProperty.value : '';
                        var diffProperty = {
                            'alias': property.alias,
                            'label': property.label,
                            'diff': JsDiff.diffWords(property.value, oldProperty.value),
                            'isObject': property.isObject || oldProperty.isObject ? true : false
                        };
                        vm.diff.properties.push(diffProperty);
                    });
                });
            }
            function rollback() {
                vm.rollbackButtonState = 'busy';
                var nodeId = $scope.model.node.id;
                var versionId = vm.previousVersion.versionId;
                var culture = $scope.model.node.variants.length > 1 ? vm.currentVersion.language.culture : null;
                return contentResource.rollback(nodeId, versionId, culture).then(function (data) {
                    vm.rollbackButtonState = 'success';
                    submit();
                }, function (error) {
                    vm.rollbackButtonState = 'error';
                });
            }
            function submit() {
                if ($scope.model.submit) {
                    $scope.model.submit($scope.model.submit);
                }
            }
            function close() {
                if ($scope.model.close) {
                    $scope.model.close();
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.RollbackController', RollbackController);
    }());
    'use strict';
    (function () {
        'use strict';
        function SectionPickerController($scope, sectionResource, localizationService) {
            var vm = this;
            vm.sections = [];
            vm.loading = false;
            vm.selectSection = selectSection;
            vm.submit = submit;
            vm.close = close;
            //////////
            function onInit() {
                vm.loading = true;
                // set default title
                if (!$scope.model.title) {
                    localizationService.localize('defaultdialogs_selectSections').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                // make sure we can push to something
                if (!$scope.model.selection) {
                    $scope.model.selection = [];
                }
                // get sections
                sectionResource.getAllSections().then(function (sections) {
                    vm.sections = sections;
                    setSectionIcon(vm.sections);
                    if ($scope.model.selection && $scope.model.selection.length > 0) {
                        preSelect($scope.model.selection);
                    }
                    vm.loading = false;
                });
            }
            function preSelect(selection) {
                angular.forEach(selection, function (selected) {
                    angular.forEach(vm.sections, function (section) {
                        if (selected.alias === section.alias) {
                            section.selected = true;
                        }
                    });
                });
            }
            function selectSection(section) {
                if (!section.selected) {
                    section.selected = true;
                    $scope.model.selection.push(section);
                } else {
                    angular.forEach($scope.model.selection, function (selectedSection, index) {
                        if (selectedSection.alias === section.alias) {
                            section.selected = false;
                            $scope.model.selection.splice(index, 1);
                        }
                    });
                }
            }
            function setSectionIcon(sections) {
                angular.forEach(sections, function (section) {
                    section.icon = 'icon-section ' + section.cssclass;
                });
            }
            function submit(model) {
                if ($scope.model.submit) {
                    $scope.model.submit(model);
                }
            }
            function close() {
                if ($scope.model.close) {
                    $scope.model.close();
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.SectionPickerController', SectionPickerController);
    }());
    'use strict';
    (function () {
        'use strict';
        function TemplateSectionsController($scope, formHelper) {
            var vm = this;
            vm.select = select;
            vm.submit = submit;
            vm.close = close;
            $scope.model.mandatoryRenderSection = false;
            if (!$scope.model.title) {
                $scope.model.title = 'Sections';
            }
            function onInit() {
                if ($scope.model.hasMaster) {
                    $scope.model.insertType = 'addSection';
                } else {
                    $scope.model.insertType = 'renderBody';
                }
            }
            function select(type) {
                $scope.model.insertType = type;
            }
            function submit(model) {
                if (formHelper.submitForm({ scope: $scope })) {
                    $scope.model.submit($scope.model);
                }
            }
            function close() {
                if ($scope.model.close) {
                    $scope.model.close();
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.TemplateSectionsController', TemplateSectionsController);
    }());
    'use strict';
    //used for the media picker dialog
    angular.module('umbraco').controller('Umbraco.Editors.TreePickerController', function ($scope, entityResource, eventsService, angularHelper, $timeout, localizationService, treeService, languageResource) {
        //used as the result selection
        $scope.model.selection = [];
        //the tree object when it loads
        var tree = null;
        // Search and listviews is only working for content, media and member section
        var searchableSections = [
            'content',
            'media',
            'member'
        ];
        // tracks all expanded paths so when the language is switched we can resync it with the already loaded paths
        var expandedPaths = [];
        var vm = this;
        vm.treeReady = false;
        vm.dialogTreeApi = {};
        vm.initDialogTree = initDialogTree;
        vm.section = $scope.model.section;
        vm.treeAlias = $scope.model.treeAlias;
        vm.multiPicker = $scope.model.multiPicker;
        vm.hideHeader = typeof $scope.model.hideHeader === 'boolean' ? $scope.model.hideHeader : true;
        // if you need to load a not initialized tree set this value to false - default is true
        vm.onlyInitialized = $scope.model.onlyInitialized;
        vm.searchInfo = {
            searchFromId: $scope.model.startNodeId,
            searchFromName: null,
            showSearch: false,
            results: [],
            selectedSearchResults: []
        };
        vm.startNodeId = $scope.model.startNodeId;
        //Used for toggling an empty-state message
        //Some trees can have no items (dictionary & forms email templates)
        vm.hasItems = true;
        vm.emptyStateMessage = $scope.model.emptyStateMessage;
        vm.languages = [];
        vm.selectedLanguage = {};
        vm.languageSelectorIsOpen = false;
        vm.showLanguageSelector = $scope.model.showLanguageSelector;
        // Allow the entity type to be passed in but defaults to Document for backwards compatibility.
        vm.entityType = $scope.model.entityType ? $scope.model.entityType : 'Document';
        vm.enableSearh = searchableSections.indexOf(vm.section) !== -1;
        vm.toggleLanguageSelector = toggleLanguageSelector;
        vm.selectLanguage = selectLanguage;
        vm.onSearchResults = onSearchResults;
        vm.hideSearch = hideSearch;
        vm.closeMiniListView = closeMiniListView;
        vm.selectListViewNode = selectListViewNode;
        vm.submit = submit;
        vm.close = close;
        function initDialogTree() {
            vm.dialogTreeApi.callbacks.treeLoaded(treeLoadedHandler);
            //TODO: Also deal with unexpanding!!
            vm.dialogTreeApi.callbacks.treeNodeExpanded(nodeExpandedHandler);
            vm.dialogTreeApi.callbacks.treeNodeSelect(nodeSelectHandler);
        }
        /**
   * Performs the initialization of this component
   */
        function onInit() {
            // load languages
            languageResource.getAll().then(function (languages) {
                vm.languages = languages;
                // set the default language
                vm.languages.forEach(function (language) {
                    if (language.isDefault) {
                        vm.selectedLanguage = language;
                        vm.languageSelectorIsOpen = false;
                    }
                });
            });
            if (vm.treeAlias === 'content') {
                vm.entityType = 'Document';
                if (!$scope.model.title) {
                    localizationService.localize('defaultdialogs_selectContent').then(function (value) {
                        $scope.model.title = value;
                    });
                }
            } else if (vm.treeAlias === 'member' || vm.section === 'member') {
                vm.entityType = 'Member';
                if (!$scope.model.title) {
                    localizationService.localize('defaultdialogs_selectMember').then(function (value) {
                        $scope.model.title = value;
                    });
                }
            } else if (vm.treeAlias === 'media' || vm.section === 'media') {
                vm.entityType = 'Media';
                if (!$scope.model.title) {
                    localizationService.localize('defaultdialogs_selectMedia').then(function (value) {
                        $scope.model.title = value;
                    });
                }
            }
            //TODO: Seems odd this logic is here, i don't think it needs to be and should just exist on the property editor using this
            if ($scope.model.minNumber) {
                $scope.model.minNumber = parseInt($scope.model.minNumber, 10);
            }
            if ($scope.model.maxNumber) {
                $scope.model.maxNumber = parseInt($scope.model.maxNumber, 10);
            }
            //if a alternative startnode is used, we need to check if it is a container
            if (vm.enableSearh && vm.startNodeId && vm.startNodeId !== -1 && vm.startNodeId !== '-1') {
                entityResource.getById(vm.startNodeId, vm.entityType).then(function (node) {
                    if (node.metaData.IsContainer) {
                        openMiniListView(node);
                    }
                    initTree();
                });
            } else {
                initTree();
            }
            //Configures filtering
            if ($scope.model.filter) {
                $scope.model.filterExclude = false;
                $scope.model.filterAdvanced = false;
                //used advanced filtering
                if (angular.isFunction($scope.model.filter)) {
                    $scope.model.filterAdvanced = true;
                } else if (angular.isObject($scope.model.filter)) {
                    $scope.model.filterAdvanced = true;
                } else {
                    if ($scope.model.filter.startsWith('!')) {
                        $scope.model.filterExclude = true;
                        $scope.model.filter = $scope.model.filter.substring(1);
                    }
                    //used advanced filtering
                    if ($scope.model.filter.startsWith('{')) {
                        $scope.model.filterAdvanced = true;
                        //convert to object
                        $scope.model.filter = angular.fromJson($scope.model.filter);
                    }
                }
            }
        }
        /**
   * Updates the tree's query parameters
   */
        function initTree() {
            //create the custom query string param for this tree
            var queryParams = {};
            if (vm.startNodeId) {
                queryParams['startNodeId'] = $scope.model.startNodeId;
            }
            if (vm.selectedLanguage && vm.selectedLanguage.id) {
                queryParams['culture'] = vm.selectedLanguage.culture;
            }
            var queryString = $.param(queryParams);
            //create the query string from the params object
            if (!queryString) {
                vm.customTreeParams = $scope.model.customTreeParams;
            } else {
                vm.customTreeParams = queryString;
                if ($scope.model.customTreeParams) {
                    vm.customTreeParams += '&' + $scope.model.customTreeParams;
                }
            }
            vm.treeReady = true;
        }
        function selectLanguage(language) {
            vm.selectedLanguage = language;
            // close the language selector
            vm.languageSelectorIsOpen = false;
            initTree();
            //this will reset the tree params and the tree directive will pick up the changes in a $watch
            //execute after next digest because the internal watch on the customtreeparams needs to be bound now that we've changed it
            $timeout(function () {
                //reload the tree with it's updated querystring args
                vm.dialogTreeApi.load(vm.section).then(function () {
                    //create the list of promises
                    var promises = [];
                    for (var i = 0; i < expandedPaths.length; i++) {
                        promises.push(vm.dialogTreeApi.syncTree({
                            path: expandedPaths[i],
                            activate: false
                        }));
                    }
                    //execute them sequentially
                    angularHelper.executeSequentialPromises(promises);
                });
            });
        }
        ;
        function toggleLanguageSelector() {
            vm.languageSelectorIsOpen = !vm.languageSelectorIsOpen;
        }
        ;
        function nodeExpandedHandler(args) {
            //store the reference to the expanded node path
            if (args.node) {
                treeService._trackExpandedPaths(args.node, expandedPaths);
            }
            // open mini list view for list views
            if (args.node.metaData.isContainer) {
                openMiniListView(args.node);
            }
            if (angular.isArray(args.children)) {
                //iterate children
                _.each(args.children, function (child) {
                    //now we need to look in the already selected search results and
                    // toggle the check boxes for those ones that are listed
                    var exists = _.find(vm.searchInfo.selectedSearchResults, function (selected) {
                        return child.id == selected.id;
                    });
                    if (exists) {
                        child.selected = true;
                    }
                });
                //check filter
                performFiltering(args.children);
            }
        }
        //gets the tree object when it loads
        function treeLoadedHandler(args) {
            //args.tree contains children (args.tree.root.children)
            vm.hasItems = args.tree.root.children.length > 0;
            tree = args.tree;
        }
        //wires up selection
        function nodeSelectHandler(args) {
            args.event.preventDefault();
            args.event.stopPropagation();
            if (args.node.metaData.isSearchResult) {
                //check if the item selected was a search result from a list view
                //unselect
                select(args.node.name, args.node.id);
                //remove it from the list view children
                var listView = args.node.parent();
                listView.children = _.reject(listView.children, function (child) {
                    return child.id == args.node.id;
                });
                //remove it from the custom tracked search result list
                vm.searchInfo.selectedSearchResults = _.reject(vm.searchInfo.selectedSearchResults, function (i) {
                    return i.id == args.node.id;
                });
            } else {
                eventsService.emit('dialogs.treePickerController.select', args);
                if (args.node.filtered) {
                    return;
                }
                //This is a tree node, so we don't have an entity to pass in, it will need to be looked up
                //from the server in this method.
                if ($scope.model.select) {
                    $scope.model.select(args.node);
                } else {
                    select(args.node.name, args.node.id);
                    //toggle checked state
                    args.node.selected = args.node.selected === true ? false : true;
                }
            }
        }
        /** Method used for selecting a node */
        function select(text, id, entity) {
            //if we get the root, we just return a constructed entity, no need for server data
            if (id < 0) {
                var rootNode = {
                    alias: null,
                    icon: 'icon-folder',
                    id: id,
                    name: text
                };
                if (vm.multiPicker) {
                    if (entity) {
                        multiSelectItem(entity);
                    } else {
                        multiSelectItem(rootNode);
                    }
                } else {
                    $scope.model.selection.push(rootNode);
                    $scope.model.submit($scope.model);
                }
            } else {
                if (vm.multiPicker) {
                    if (entity) {
                        multiSelectItem(entity);
                    } else {
                        //otherwise we have to get it from the server
                        entityResource.getById(id, vm.entityType).then(function (ent) {
                            multiSelectItem(ent);
                        });
                    }
                } else {
                    hideSearch();
                    //if an entity has been passed in, use it
                    if (entity) {
                        $scope.model.selection.push(entity);
                        $scope.model.submit($scope.model);
                    } else {
                        //otherwise we have to get it from the server
                        entityResource.getById(id, vm.entityType).then(function (ent) {
                            $scope.model.selection.push(ent);
                            $scope.model.submit($scope.model);
                        });
                    }
                }
            }
        }
        function multiSelectItem(item) {
            var found = false;
            var foundIndex = 0;
            if ($scope.model.selection.length > 0) {
                for (var i = 0; $scope.model.selection.length > i; i++) {
                    var selectedItem = $scope.model.selection[i];
                    if (selectedItem.id === item.id) {
                        found = true;
                        foundIndex = i;
                    }
                }
            }
            if (found) {
                $scope.model.selection.splice(foundIndex, 1);
            } else {
                $scope.model.selection.push(item);
            }
        }
        function performFiltering(nodes) {
            if (!$scope.model.filter) {
                return;
            }
            //remove any list view search nodes from being filtered since these are special nodes that always must
            // be allowed to be clicked on
            nodes = _.filter(nodes, function (n) {
                return !angular.isObject(n.metaData.listViewNode);
            });
            if ($scope.model.filterAdvanced) {
                //filter either based on a method or an object
                var filtered = angular.isFunction($scope.model.filter) ? _.filter(nodes, $scope.model.filter) : _.where(nodes, $scope.model.filter);
                angular.forEach(filtered, function (value, key) {
                    value.filtered = true;
                    if ($scope.model.filterCssClass) {
                        if (!value.cssClasses) {
                            value.cssClasses = [];
                        }
                        value.cssClasses.push($scope.model.filterCssClass);
                    }
                });
            } else {
                var a = $scope.model.filter.toLowerCase().replace(/\s/g, '').split(',');
                angular.forEach(nodes, function (value, key) {
                    var found = a.indexOf(value.metaData.contentType.toLowerCase()) >= 0;
                    if (!$scope.model.filterExclude && !found || $scope.model.filterExclude && found) {
                        value.filtered = true;
                        if ($scope.model.filterCssClass) {
                            if (!value.cssClasses) {
                                value.cssClasses = [];
                            }
                            value.cssClasses.push($scope.model.filterCssClass);
                        }
                    }
                });
            }
        }
        function openMiniListView(node) {
            vm.miniListView = node;
        }
        function multiSubmit(result) {
            entityResource.getByIds(result, vm.entityType).then(function (ents) {
                $scope.submit(ents);
            });
        }
        /** method to select a search result */
        function selectResult(evt, result) {
            if (result.filtered) {
                return;
            }
            result.selected = result.selected === true ? false : true;
            //since result = an entity, we'll pass it in so we don't have to go back to the server
            select(result.name, result.id, result);
            //add/remove to our custom tracked list of selected search results
            if (result.selected) {
                vm.searchInfo.selectedSearchResults.push(result);
            } else {
                vm.searchInfo.selectedSearchResults = _.reject(vm.searchInfo.selectedSearchResults, function (i) {
                    return i.id == result.id;
                });
            }
            //ensure the tree node in the tree is checked/unchecked if it already exists there
            if (tree) {
                var found = treeService.getDescendantNode(tree.root, result.id);
                if (found) {
                    found.selected = result.selected;
                }
            }
        }
        function hideSearch() {
            //Traverse the entire displayed tree and update each node to sync with the selected search results
            if (tree) {
                //we need to ensure that any currently displayed nodes that get selected
                // from the search get updated to have a check box!
                var checkChildren = function checkChildren(children) {
                    _.each(children, function (child) {
                        //check if the id is in the selection, if so ensure it's flagged as selected
                        var exists = _.find(vm.searchInfo.selectedSearchResults, function (selected) {
                            return child.id == selected.id;
                        });
                        //if the curr node exists in selected search results, ensure it's checked
                        if (exists) {
                            child.selected = true;
                        }    //if the curr node does not exist in the selected search result, and the curr node is a child of a list view search result
                        else if (child.metaData.isSearchResult) {
                            //if this tree node is under a list view it means that the node was added
                            // to the tree dynamically under the list view that was searched, so we actually want to remove
                            // it all together from the tree
                            var listView = child.parent();
                            listView.children = _.reject(listView.children, function (c) {
                                return c.id == child.id;
                            });
                        }
                        //check if the current node is a list view and if so, check if there's any new results
                        // that need to be added as child nodes to it based on search results selected
                        if (child.metaData.isContainer) {
                            child.cssClasses = _.reject(child.cssClasses, function (c) {
                                return c === 'tree-node-slide-up-hide-active';
                            });
                            var listViewResults = _.filter(vm.searchInfo.selectedSearchResults, function (i) {
                                return i.parentId == child.id;
                            });
                            _.each(listViewResults, function (item) {
                                var childExists = _.find(child.children, function (c) {
                                    return c.id == item.id;
                                });
                                if (!childExists) {
                                    var _parent = child;
                                    child.children.unshift({
                                        id: item.id,
                                        name: item.name,
                                        cssClass: 'icon umb-tree-icon sprTree ' + item.icon,
                                        level: child.level + 1,
                                        metaData: { isSearchResult: true },
                                        hasChildren: false,
                                        parent: function parent() {
                                            return _parent;
                                        }
                                    });
                                }
                            });
                        }
                        //recurse
                        if (child.children && child.children.length > 0) {
                            checkChildren(child.children);
                        }
                    });
                };
                checkChildren(tree.root.children);
            }
            vm.searchInfo.showSearch = false;
            vm.searchInfo.searchFromId = vm.startNodeId;
            vm.searchInfo.searchFromName = null;
            vm.searchInfo.results = [];
        }
        function onSearchResults(results) {
            //filter all items - this will mark an item as filtered
            performFiltering(results);
            //now actually remove all filtered items so they are not even displayed
            results = _.filter(results, function (item) {
                return !item.filtered;
            });
            vm.searchInfo.results = results;
            //sync with the curr selected results
            _.each(vm.searchInfo.results, function (result) {
                var exists = _.find($scope.model.selection, function (selectedId) {
                    return result.id == selectedId;
                });
                if (exists) {
                    result.selected = true;
                }
            });
            vm.searchInfo.showSearch = true;
        }
        function selectListViewNode(node) {
            select(node.name, node.id);
            //toggle checked state
            node.selected = node.selected === true ? false : true;
        }
        function closeMiniListView() {
            vm.miniListView = undefined;
        }
        function submit(model) {
            if ($scope.model.submit) {
                $scope.model.submit(model);
            }
        }
        function close() {
            if ($scope.model.close) {
                $scope.model.close();
            }
        }
        //initialize
        onInit();
    });
    'use strict';
    (function () {
        'use strict';
        function UserGroupPickerController($scope, userGroupsResource, localizationService) {
            var vm = this;
            vm.userGroups = [];
            vm.loading = false;
            vm.selectUserGroup = selectUserGroup;
            vm.submit = submit;
            vm.close = close;
            //////////
            function onInit() {
                vm.loading = true;
                // set default title
                if (!$scope.model.title) {
                    localizationService.localize('user_selectUserGroups').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                // make sure we can push to something
                if (!$scope.model.selection) {
                    $scope.model.selection = [];
                }
                // get venues
                userGroupsResource.getUserGroups().then(function (userGroups) {
                    vm.userGroups = userGroups;
                    if ($scope.model.selection && $scope.model.selection.length > 0) {
                        preSelect($scope.model.selection);
                    }
                    vm.loading = false;
                });
            }
            function preSelect(selection) {
                angular.forEach(selection, function (selected) {
                    angular.forEach(vm.userGroups, function (userGroup) {
                        if (selected.id === userGroup.id) {
                            userGroup.selected = true;
                        }
                    });
                });
            }
            function selectUserGroup(userGroup) {
                if (!userGroup.selected) {
                    userGroup.selected = true;
                    $scope.model.selection.push(userGroup);
                } else {
                    angular.forEach($scope.model.selection, function (selectedUserGroup, index) {
                        if (selectedUserGroup.id === userGroup.id) {
                            userGroup.selected = false;
                            $scope.model.selection.splice(index, 1);
                        }
                    });
                }
            }
            function submit(model) {
                if ($scope.model.submit) {
                    $scope.model.submit(model);
                }
            }
            function close() {
                if ($scope.model.close) {
                    $scope.model.close();
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.UserGroupPickerController', UserGroupPickerController);
    }());
    'use strict';
    (function () {
        'use strict';
        function UserPickerController($scope, usersResource, localizationService) {
            var vm = this;
            vm.users = [];
            vm.loading = false;
            vm.usersOptions = {};
            vm.selectUser = selectUser;
            vm.searchUsers = searchUsers;
            vm.changePageNumber = changePageNumber;
            vm.submit = submit;
            vm.close = close;
            //////////
            function onInit() {
                vm.loading = true;
                // set default title
                if (!$scope.model.title) {
                    localizationService.localize('defaultdialogs_selectUsers').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                // make sure we can push to something
                if (!$scope.model.selection) {
                    $scope.model.selection = [];
                }
                // get users
                getUsers();
            }
            function preSelect(selection, users) {
                angular.forEach(selection, function (selected) {
                    angular.forEach(users, function (user) {
                        if (selected.id === user.id) {
                            user.selected = true;
                        }
                    });
                });
            }
            function selectUser(user) {
                if (!user.selected) {
                    user.selected = true;
                    $scope.model.selection.push(user);
                } else {
                    angular.forEach($scope.model.selection, function (selectedUser, index) {
                        if (selectedUser.id === user.id) {
                            user.selected = false;
                            $scope.model.selection.splice(index, 1);
                        }
                    });
                }
            }
            var search = _.debounce(function () {
                $scope.$apply(function () {
                    getUsers();
                });
            }, 500);
            function searchUsers() {
                search();
            }
            function getUsers() {
                vm.loading = true;
                // Get users
                usersResource.getPagedResults(vm.usersOptions).then(function (users) {
                    vm.users = users.items;
                    vm.usersOptions.pageNumber = users.pageNumber;
                    vm.usersOptions.pageSize = users.pageSize;
                    vm.usersOptions.totalItems = users.totalItems;
                    vm.usersOptions.totalPages = users.totalPages;
                    preSelect($scope.model.selection, vm.users);
                    vm.loading = false;
                });
            }
            function changePageNumber(pageNumber) {
                vm.usersOptions.pageNumber = pageNumber;
                getUsers();
            }
            function submit(model) {
                if ($scope.model.submit) {
                    $scope.model.submit(model);
                }
            }
            function close() {
                if ($scope.model.close) {
                    $scope.model.close();
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.UserPickerController', UserPickerController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.LegacyController
 * @function
 * 
 * @description
 * A controller to control the legacy iframe injection
 * 
*/
    function LegacyController($scope, $routeParams, $element) {
        var url = decodeURIComponent($routeParams.url.replace(/javascript\:/gi, ''));
        //split into path and query
        var urlParts = url.split('?');
        var extIndex = urlParts[0].lastIndexOf('.');
        var ext = extIndex === -1 ? '' : urlParts[0].substr(extIndex);
        //path cannot be a js file
        if (ext !== '.js' || ext === '') {
            //path cannot contain any of these chars
            var toClean = '*(){}[];:<>\\|\'"';
            for (var i = 0; i < toClean.length; i++) {
                var reg = new RegExp('\\' + toClean[i], 'g');
                urlParts[0] = urlParts[0].replace(reg, '');
            }
            //join cleaned path and query back together
            url = urlParts[0] + (urlParts.length === 1 ? '' : '?' + urlParts[1]);
            $scope.legacyPath = url;
        } else {
            throw 'Invalid url';
        }
    }
    angular.module('umbraco').controller('Umbraco.LegacyController', LegacyController);
    'use strict';
    /** This controller is simply here to launch the login dialog when the route is explicitly changed to /login */
    angular.module('umbraco').controller('Umbraco.LoginController', function (eventsService, $scope, userService, $location, $rootScope) {
        userService._showLoginDialog();
        var evtOn = eventsService.on('app.ready', function (evt, data) {
            $scope.avatar = 'assets/img/application/logo.png';
            var path = '/';
            //check if there's a returnPath query string, if so redirect to it
            var locationObj = $location.search();
            if (locationObj.returnPath) {
                path = decodeURIComponent(locationObj.returnPath);
            }
            $location.url(path);
        });
        $scope.$on('$destroy', function () {
            eventsService.unsubscribe(evtOn);
        });
    });
    'use strict';
    //used for the media picker dialog
    angular.module('umbraco').controller('Umbraco.Notifications.ConfirmRouteChangeController', function ($scope, $location, $log, notificationsService, navigationService) {
        $scope.discard = function (not) {
            // allow for a callback for discard click
            if (not.args.onDiscard) {
                not.args.onDiscard();
                return;
            }
            // when no callback is added run the normal functionality of the discard button
            not.args.listener();
            navigationService.clearSearch();
            //we need to break the path up into path and query
            var parts = not.args.path.split('?');
            var query = {};
            if (parts.length > 1) {
                _.each(parts[1].split('&'), function (q) {
                    var keyVal = q.split('=');
                    query[keyVal[0]] = keyVal[1];
                });
            }
            $location.path(parts[0]).search(query);
            notificationsService.remove(not);
        };
        $scope.stay = function (not) {
            notificationsService.remove(not);
        };
    });
    'use strict';
    angular.module('umbraco').controller('Umbraco.Notifications.ConfirmUnpublishController', function ($scope, notificationsService, eventsService) {
        $scope.confirm = function (not, action) {
            eventsService.emit('content.confirmUnpublish', action);
            notificationsService.remove(not);
        };
    });
    'use strict';
    function ItemPickerOverlay($scope, localizationService) {
        function onInit() {
            $scope.model.hideSubmitButton = true;
            if (!$scope.model.title) {
                localizationService.localize('defaultdialogs_selectItem').then(function (value) {
                    $scope.model.title = value;
                });
            }
        }
        $scope.selectItem = function (item) {
            $scope.model.selectedItem = item;
            $scope.submitForm($scope.model);
        };
        onInit();
    }
    angular.module('umbraco').controller('Umbraco.Overlays.ItemPickerOverlay', ItemPickerOverlay);
    'use strict';
    angular.module('umbraco').controller('Umbraco.Overlays.MediaTypePickerController', function ($scope) {
        $scope.select = function (mediatype) {
            $scope.model.selectedType = mediatype;
            $scope.model.submit($scope.model);
            $scope.model.show = false;
        };
    });
    'use strict';
    angular.module('umbraco').controller('Umbraco.Overlays.UserController', function ($scope, $location, $timeout, dashboardResource, userService, historyService, eventsService, externalLoginInfo, authResource, currentUserResource, formHelper, localizationService) {
        $scope.history = historyService.getCurrent();
        $scope.version = Umbraco.Sys.ServerVariables.application.version + ' assembly: ' + Umbraco.Sys.ServerVariables.application.assemblyVersion;
        $scope.showPasswordFields = false;
        $scope.changePasswordButtonState = 'init';
        $scope.model.subtitle = 'Umbraco version' + ' ' + $scope.version;
        if (!$scope.model.title) {
            localizationService.localize('general_user').then(function (value) {
                $scope.model.title = value;
            });
        }
        $scope.externalLoginProviders = externalLoginInfo.providers;
        $scope.externalLinkLoginFormAction = Umbraco.Sys.ServerVariables.umbracoUrls.externalLinkLoginsUrl;
        var evts = [];
        evts.push(eventsService.on('historyService.add', function (e, args) {
            $scope.history = args.all;
        }));
        evts.push(eventsService.on('historyService.remove', function (e, args) {
            $scope.history = args.all;
        }));
        evts.push(eventsService.on('historyService.removeAll', function (e, args) {
            $scope.history = [];
        }));
        $scope.logout = function () {
            //Add event listener for when there are pending changes on an editor which means our route was not successful
            var pendingChangeEvent = eventsService.on('valFormManager.pendingChanges', function (e, args) {
                //one time listener, remove the event
                pendingChangeEvent();
                $scope.model.close();
            });
            //perform the path change, if it is successful then the promise will resolve otherwise it will fail
            $scope.model.close();
            $location.path('/logout').search('');
        };
        $scope.gotoHistory = function (link) {
            $location.path(link);
            $scope.model.close();
        };
        //Manually update the remaining timeout seconds
        function updateTimeout() {
            $timeout(function () {
                if ($scope.remainingAuthSeconds > 0) {
                    $scope.remainingAuthSeconds--;
                    $scope.$digest();
                    //recurse
                    updateTimeout();
                }
            }, 1000, false);    // 1 second, do NOT execute a global digest
        }
        function updateUserInfo() {
            //get the user
            userService.getCurrentUser().then(function (user) {
                $scope.user = user;
                if ($scope.user) {
                    $scope.model.title = user.name;
                    $scope.remainingAuthSeconds = $scope.user.remainingAuthSeconds;
                    $scope.canEditProfile = _.indexOf($scope.user.allowedSections, 'users') > -1;
                    //set the timer
                    updateTimeout();
                    authResource.getCurrentUserLinkedLogins().then(function (logins) {
                        //reset all to be un-linked
                        for (var provider in $scope.externalLoginProviders) {
                            $scope.externalLoginProviders[provider].linkedProviderKey = undefined;
                        }
                        //set the linked logins
                        for (var login in logins) {
                            var found = _.find($scope.externalLoginProviders, function (i) {
                                return i.authType == login;
                            });
                            if (found) {
                                found.linkedProviderKey = logins[login];
                            }
                        }
                    });
                }
            });
        }
        $scope.unlink = function (e, loginProvider, providerKey) {
            var result = confirm('Are you sure you want to unlink this account?');
            if (!result) {
                e.preventDefault();
                return;
            }
            authResource.unlinkLogin(loginProvider, providerKey).then(function (a, b, c) {
                updateUserInfo();
            });
        };
        updateUserInfo();
        //remove all event handlers
        $scope.$on('$destroy', function () {
            for (var e = 0; e < evts.length; e++) {
                evts[e]();
            }
        });
        /* ---------- UPDATE PASSWORD ---------- */
        //create the initial model for change password
        $scope.changePasswordModel = {
            config: {},
            value: {}
        };
        //go get the config for the membership provider and add it to the model
        authResource.getMembershipProviderConfig().then(function (data) {
            $scope.changePasswordModel.config = data;
            //ensure the hasPassword config option is set to true (the user of course has a password already assigned)
            //this will ensure the oldPassword is shown so they can change it
            // disable reset password functionality beacuse it does not make sense inside the backoffice
            $scope.changePasswordModel.config.hasPassword = true;
            $scope.changePasswordModel.config.disableToggle = true;
            $scope.changePasswordModel.config.enableReset = false;
        });
        $scope.changePassword = function () {
            if (formHelper.submitForm({ scope: $scope })) {
                $scope.changePasswordButtonState = 'busy';
                currentUserResource.changePassword($scope.changePasswordModel.value).then(function (data) {
                    //reset old data 
                    clearPasswordFields();
                    //if the password has been reset, then update our model
                    if (data.value) {
                        $scope.changePasswordModel.value.generatedPassword = data.value;
                    }
                    formHelper.resetForm({ scope: $scope });
                    $scope.changePasswordButtonState = 'success';
                    $timeout(function () {
                        $scope.togglePasswordFields();
                    }, 2000);
                }, function (err) {
                    formHelper.handleError(err);
                    $scope.changePasswordButtonState = 'error';
                });
            }
        };
        $scope.togglePasswordFields = function () {
            clearPasswordFields();
            $scope.showPasswordFields = !$scope.showPasswordFields;
        };
        function clearPasswordFields() {
            $scope.changePasswordModel.value.oldPassword = '';
            $scope.changePasswordModel.value.newPassword = '';
            $scope.changePasswordModel.value.confirm = '';
        }
        dashboardResource.getDashboard('user-dialog').then(function (dashboard) {
            $scope.dashboard = dashboard;
        });
    });
    'use strict';
    angular.module('umbraco').controller('Umbraco.Overlays.YsodController', function ($scope, legacyResource, treeService, navigationService, localizationService) {
        function onInit() {
            if (!$scope.model.title) {
                localizationService.localize('errors_receivedErrorFromServer').then(function (value) {
                    $scope.model.title = value;
                });
            }
            if ($scope.model.error && $scope.model.error.data && $scope.model.error.data.StackTrace) {
                //trim whitespace
                $scope.model.error.data.StackTrace = $scope.model.error.data.StackTrace.trim();
            }
            if ($scope.model.error && $scope.model.error.data) {
                $scope.model.error.data.InnerExceptions = [];
                var ex = $scope.model.error.data.InnerException;
                while (ex) {
                    if (ex.StackTrace) {
                        ex.StackTrace = ex.StackTrace.trim();
                    }
                    $scope.model.error.data.InnerExceptions.push(ex);
                    ex = ex.InnerException;
                }
            }
        }
        onInit();
    });
    'use strict';
    (function () {
        'use strict';
        function NodeNameController($scope) {
            var vm = this;
            var element = angular.element($scope.model.currentStep.element);
            vm.error = false;
            vm.initNextStep = initNextStep;
            function initNextStep() {
                if (element.val().toLowerCase() === 'home') {
                    $scope.model.nextStep();
                } else {
                    vm.error = true;
                }
            }
        }
        angular.module('umbraco').controller('Umbraco.Tours.UmbIntroCreateContent.NodeNameController', NodeNameController);
    }());
    'use strict';
    (function () {
        'use strict';
        function DocTypeNameController($scope) {
            var vm = this;
            var element = angular.element($scope.model.currentStep.element);
            vm.error = false;
            vm.initNextStep = initNextStep;
            function initNextStep() {
                if (element.val().toLowerCase() === 'home page') {
                    $scope.model.nextStep();
                } else {
                    vm.error = true;
                }
            }
        }
        angular.module('umbraco').controller('Umbraco.Tours.UmbIntroCreateDocType.DocTypeNameController', DocTypeNameController);
    }());
    'use strict';
    (function () {
        'use strict';
        function PropertyNameController($scope) {
            var vm = this;
            var element = angular.element($scope.model.currentStep.element);
            vm.error = false;
            vm.initNextStep = initNextStep;
            function initNextStep() {
                if (element.val().toLowerCase() === 'welcome text') {
                    $scope.model.nextStep();
                } else {
                    vm.error = true;
                }
            }
        }
        angular.module('umbraco').controller('Umbraco.Tours.UmbIntroCreateDocType.PropertyNameController', PropertyNameController);
    }());
    'use strict';
    (function () {
        'use strict';
        function TabNameController($scope) {
            var vm = this;
            var element = angular.element($scope.model.currentStep.element);
            vm.error = false;
            vm.initNextStep = initNextStep;
            function initNextStep() {
                if (element.val().toLowerCase() === 'home') {
                    $scope.model.nextStep();
                } else {
                    vm.error = true;
                }
            }
        }
        angular.module('umbraco').controller('Umbraco.Tours.UmbIntroCreateDocType.TabNameController', TabNameController);
    }());
    'use strict';
    (function () {
        'use strict';
        function FolderNameController($scope) {
            var vm = this;
            var element = angular.element($scope.model.currentStep.element);
            vm.error = false;
            vm.initNextStep = initNextStep;
            function initNextStep() {
                if (element.val().toLowerCase() === 'my images') {
                    $scope.model.nextStep();
                } else {
                    vm.error = true;
                }
            }
        }
        angular.module('umbraco').controller('Umbraco.Tours.UmbIntroMediaSection.FolderNameController', FolderNameController);
    }());
    'use strict';
    (function () {
        'use strict';
        function UploadImagesController($scope, editorState, mediaResource) {
            var vm = this;
            var element = angular.element($scope.model.currentStep.element);
            vm.error = false;
            vm.initNextStep = initNextStep;
            function initNextStep() {
                vm.error = false;
                vm.buttonState = 'busy';
                var currentNode = editorState.getCurrent();
                // make sure we have uploaded at least one image
                mediaResource.getChildren(currentNode.id).then(function (data) {
                    var children = data;
                    if (children.items && children.items.length > 0) {
                        $scope.model.nextStep();
                    } else {
                        vm.error = true;
                    }
                    vm.buttonState = 'init';
                });
            }
        }
        angular.module('umbraco').controller('Umbraco.Tours.UmbIntroMediaSection.UploadImagesController', UploadImagesController);
    }());
    'use strict';
    (function () {
        'use strict';
        function TemplatesTreeController($scope) {
            var vm = this;
            var eventElement = angular.element($scope.model.currentStep.eventElement);
            function onInit() {
                // check if tree is already open - if it is - go to next step
                if (eventElement.hasClass('icon-navigation-down')) {
                    $scope.model.nextStep();
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Tours.UmbIntroRenderInTemplate.TemplatesTreeController', TemplatesTreeController);
    }());
    'use strict';
    (function () {
        'use strict';
        function ContentAppContentController($scope, $timeout, serverValidationManager) {
            //the contentApp's viewModel is actually the index of the variant being edited, not the variant itself.
            //if we make the viewModel the variant itself, we end up with a circular reference in the models which isn't ideal
            // (i.e. variant.apps[contentApp].viewModel = variant)
            //so instead since we already have access to the content, we can just get the variant directly by the index.
            var vm = this;
            vm.loading = true;
            function onInit() {
                //get the variant by index (see notes above)
                vm.content = $scope.content.variants[$scope.model.viewModel];
                serverValidationManager.notify();
                vm.loading = false;
                //if this variant has a culture/language assigned, then we need to watch it since it will change
                //if the language drop down changes and we need to re-init
                if (vm.content.language) {
                    $scope.$watch(function () {
                        return vm.content.language.culture;
                    }, function (newVal, oldVal) {
                        if (newVal !== oldVal) {
                            vm.loading = true;
                            //TODO: Can we minimize the flicker?
                            $timeout(function () {
                                onInit();
                            }, 100);
                        }
                    });
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Content.Apps.ContentController', ContentAppContentController);
    }());
    'use strict';
    (function () {
        'use strict';
        function AssignDomainController($scope, localizationService, languageResource, contentResource, navigationService) {
            var vm = this;
            vm.closeDialog = closeDialog;
            vm.addDomain = addDomain;
            vm.removeDomain = removeDomain;
            vm.save = save;
            vm.languages = [];
            vm.domains = [];
            vm.language = null;
            function activate() {
                vm.loading = true;
                languageResource.getAll().then(function (langs) {
                    vm.languages = langs;
                    var defLang = langs.filter(function (l) {
                        return l.isDefault;
                    });
                    if (defLang.length > 0) {
                        vm.defaultLanguage = defLang[0];
                    } else {
                        vm.defaultLanguage = langs[0];
                    }
                    getCultureAndDomains().then(function () {
                        vm.loading = false;
                    });
                });
                localizationService.localize('assignDomain_inherit').then(function (value) {
                    vm.inherit = value;
                });
            }
            function getCultureAndDomains() {
                return contentResource.getCultureAndDomains($scope.currentNode.id).then(function (data) {
                    if (data.language !== 'undefined') {
                        var lang = vm.languages.filter(function (l) {
                            return matchLanguageById(l, data.language.Id);
                        });
                        if (lang.length > 0) {
                            vm.language = lang[0];
                        }
                    }
                    vm.domains = data.domains.map(function (d) {
                        var matchedLangs = vm.languages.filter(function (lng) {
                            return matchLanguageById(lng, d.lang);
                        });
                        return {
                            name: d.name,
                            lang: matchedLangs.length > 0 ? matchedLangs[0] : vm.defaultLanguage
                        };
                    });
                });
            }
            function matchLanguageById(language, id) {
                var langId = parseInt(language.id);
                var comparisonId = parseInt(id);
                return langId === comparisonId;
            }
            function closeDialog() {
                navigationService.hideDialog();
            }
            function addDomain() {
                vm.domains.push({
                    name: '',
                    lang: vm.defaultLanguage
                });
            }
            function removeDomain(index) {
                vm.domains.splice(index, 1);
            }
            function save() {
                vm.submitButtonState = 'busy';
                if (vm.domainForm.$valid) {
                    // clear validation messages
                    vm.domains.forEach(function (domain) {
                        domain.duplicate = null;
                        domain.other = null;
                    });
                    var data = {
                        nodeId: $scope.currentNode.id,
                        domains: vm.domains.map(function (d) {
                            return {
                                name: d.name,
                                lang: d.lang.id
                            };
                        }),
                        language: vm.language != null ? vm.language.id : 0
                    };
                    contentResource.saveLanguageAndDomains(data).then(function (response) {
                        // validation is interesting. Check if response is valid
                        if (response.valid) {
                            vm.submitButtonState = 'success';    // show validation messages for each domain
                        } else {
                            response.domains.forEach(function (validation) {
                                vm.domains.forEach(function (domain) {
                                    if (validation.name === domain.name) {
                                        domain.duplicate = validation.duplicate;
                                        domain.other = validation.other;
                                    }
                                });
                            });
                            vm.submitButtonState = 'error';
                        }
                    }, function (e) {
                        vm.submitButtonState = 'error';
                    });
                } else {
                    vm.submitButtonState = 'error';
                }
            }
            activate();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Content.AssignDomainController', AssignDomainController);
    }());
    'use strict';
    angular.module('umbraco').controller('Umbraco.Editors.Content.CopyController', function ($scope, userService, eventsService, contentResource, navigationService, appState, treeService, localizationService, notificationsService) {
        var searchText = 'Search...';
        localizationService.localize('general_search').then(function (value) {
            searchText = value + '...';
        });
        $scope.relateToOriginal = true;
        $scope.recursive = true;
        $scope.dialogTreeApi = {};
        $scope.busy = false;
        $scope.searchInfo = {
            searchFromId: null,
            searchFromName: null,
            showSearch: false,
            results: [],
            selectedSearchResults: []
        };
        $scope.treeModel = { hideHeader: false };
        $scope.toggle = toggleHandler;
        userService.getCurrentUser().then(function (userData) {
            $scope.treeModel.hideHeader = userData.startContentIds.length > 0 && userData.startContentIds.indexOf(-1) == -1;
        });
        $scope.source = _.clone($scope.currentNode);
        function treeLoadedHandler(args) {
            if ($scope.source && $scope.source.path) {
                $scope.dialogTreeApi.syncTree({
                    path: $scope.source.path,
                    activate: false
                });
            }
        }
        function nodeSelectHandler(args) {
            if (args && args.event) {
                args.event.preventDefault();
                args.event.stopPropagation();
            }
            eventsService.emit('editors.content.copyController.select', args);
            if ($scope.target) {
                //un-select if there's a current one selected
                $scope.target.selected = false;
            }
            $scope.target = args.node;
            $scope.target.selected = true;
        }
        function nodeExpandedHandler(args) {
            // open mini list view for list views
            if (args.node.metaData.isContainer) {
                openMiniListView(args.node);
            }
        }
        function toggleHandler(type) {
            // If the relateToOriginal toggle is clicked
            if (type === 'relate') {
                if ($scope.relateToOriginal) {
                    $scope.relateToOriginal = false;
                    return;
                }
                $scope.relateToOriginal = true;
            }
            // If the recurvise toggle is clicked
            if (type === 'recursive') {
                if ($scope.recursive) {
                    $scope.recursive = false;
                    return;
                }
                $scope.recursive = true;
            }
        }
        $scope.closeDialog = function () {
            navigationService.hideDialog();
        };
        $scope.hideSearch = function () {
            $scope.searchInfo.showSearch = false;
            $scope.searchInfo.searchFromId = null;
            $scope.searchInfo.searchFromName = null;
            $scope.searchInfo.results = [];
        };
        // method to select a search result
        $scope.selectResult = function (evt, result) {
            result.selected = result.selected === true ? false : true;
            nodeSelectHandler(evt, {
                event: evt,
                node: result
            });
        };
        //callback when there are search results
        $scope.onSearchResults = function (results) {
            $scope.searchInfo.results = results;
            $scope.searchInfo.showSearch = true;
        };
        $scope.copy = function () {
            $scope.busy = true;
            $scope.error = false;
            contentResource.copy({
                parentId: $scope.target.id,
                id: $scope.source.id,
                relateToOriginal: $scope.relateToOriginal,
                recursive: $scope.recursive
            }).then(function (path) {
                $scope.error = false;
                $scope.success = true;
                $scope.busy = false;
                //get the currently edited node (if any)
                var activeNode = appState.getTreeState('selectedNode');
                //we need to do a double sync here: first sync to the copied content - but don't activate the node,
                //then sync to the currenlty edited content (note: this might not be the content that was copied!!)
                navigationService.syncTree({
                    tree: 'content',
                    path: path,
                    forceReload: true,
                    activate: false
                }).then(function (args) {
                    if (activeNode) {
                        var activeNodePath = treeService.getPath(activeNode).join();
                        //sync to this node now - depending on what was copied this might already be synced but might not be
                        navigationService.syncTree({
                            tree: 'content',
                            path: activeNodePath,
                            forceReload: false,
                            activate: true
                        });
                    }
                });
            }, function (err) {
                $scope.success = false;
                $scope.error = err;
                $scope.busy = false;
            });
        };
        $scope.onTreeInit = function () {
            $scope.dialogTreeApi.callbacks.treeLoaded(treeLoadedHandler);
            $scope.dialogTreeApi.callbacks.treeNodeSelect(nodeSelectHandler);
            $scope.dialogTreeApi.callbacks.treeNodeExpanded(nodeExpandedHandler);
        };
        // Mini list view
        $scope.selectListViewNode = function (node) {
            node.selected = node.selected === true ? false : true;
            nodeSelectHandler({}, { node: node });
        };
        $scope.closeMiniListView = function () {
            $scope.miniListView = undefined;
        };
        function openMiniListView(node) {
            $scope.miniListView = node;
        }
    });
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Content.CreateController
 * @function
 * 
 * @description
 * The controller for the content creation dialog
 */
    function contentCreateController($scope, $routeParams, contentTypeResource, iconHelper, $location, navigationService, blueprintConfig) {
        var mainCulture = $routeParams.mculture ? $routeParams.mculture : null;
        function initialize() {
            contentTypeResource.getAllowedTypes($scope.currentNode.id).then(function (data) {
                $scope.allowedTypes = iconHelper.formatContentTypeIcons(data);
            });
            $scope.selectContentType = true;
            $scope.selectBlueprint = false;
            $scope.allowBlank = blueprintConfig.allowBlank;
        }
        function close() {
            navigationService.hideMenu();
        }
        function createBlank(docType) {
            $location.path('/content/content/edit/' + $scope.currentNode.id).search('doctype', docType.alias).search('create', 'true')    /* when we create a new node we want to make sure it uses the same 
    language as what is selected in the tree */.search('cculture', mainCulture);
            close();
        }
        function createOrSelectBlueprintIfAny(docType) {
            // map the blueprints into a collection that's sortable in the view
            var blueprints = _.map(_.pairs(docType.blueprints || {}), function (pair) {
                return {
                    id: pair[0],
                    name: pair[1]
                };
            });
            $scope.docType = docType;
            if (blueprints.length) {
                if (blueprintConfig.skipSelect) {
                    createFromBlueprint(blueprints[0].id);
                } else {
                    $scope.selectContentType = false;
                    $scope.selectBlueprint = true;
                    $scope.selectableBlueprints = blueprints;
                }
            } else {
                createBlank(docType);
            }
        }
        function createFromBlueprint(blueprintId) {
            $location.path('/content/content/edit/' + $scope.currentNode.id).search('doctype', $scope.docType.alias).search('create', 'true').search('blueprintId', blueprintId);
            close();
        }
        $scope.closeDialog = function (showMenu) {
            navigationService.hideDialog(showMenu);
        };
        $scope.createBlank = createBlank;
        $scope.createOrSelectBlueprintIfAny = createOrSelectBlueprintIfAny;
        $scope.createFromBlueprint = createFromBlueprint;
        initialize();
    }
    angular.module('umbraco').controller('Umbraco.Editors.Content.CreateController', contentCreateController);
    angular.module('umbraco').value('blueprintConfig', {
        skipSelect: false,
        allowBlank: true
    });
    'use strict';
    (function () {
        function CreateBlueprintController($scope, contentResource, notificationsService, navigationService, localizationService, formHelper, contentEditingHelper) {
            $scope.message = { name: $scope.currentNode.name };
            var successText = {};
            localizationService.localize('blueprints_createBlueprintFrom', ['<em>' + $scope.message.name + '</em>']).then(function (localizedVal) {
                $scope.title = localizedVal;
            });
            $scope.cancel = function () {
                navigationService.hideMenu();
            };
            $scope.create = function () {
                if (formHelper.submitForm({
                        scope: $scope,
                        formCtrl: this.blueprintForm
                    })) {
                    contentResource.createBlueprintFromContent($scope.currentNode.id, $scope.message.name).then(function (data) {
                        formHelper.resetForm({ scope: $scope });
                        navigationService.hideMenu();
                    }, function (err) {
                        contentEditingHelper.handleSaveError({
                            redirectOnFailure: false,
                            err: err
                        });
                    });
                }
            };
        }
        angular.module('umbraco').controller('Umbraco.Editors.Content.CreateBlueprintController', CreateBlueprintController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.ContentDeleteController
 * @function
 * 
 * @description
 * The controller for deleting content
 */
    function ContentDeleteController($scope, $timeout, contentResource, treeService, navigationService, editorState, $location, overlayService) {
        /**
   * Used to toggle UI elements during delete operations
   * @param {any} isDeleting
   */
        function toggleDeleting(isDeleting) {
            $scope.currentNode.loading = isDeleting;
            $scope.busy = isDeleting;
        }
        $scope.performDelete = function () {
            // stop from firing again on double-click
            if ($scope.busy) {
                return false;
            }
            toggleDeleting(true);
            contentResource.deleteById($scope.currentNode.id).then(function () {
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                treeService.removeNode($scope.currentNode);
                toggleDeleting(false);
                if (rootNode) {
                    //ensure the recycle bin has child nodes now            
                    var recycleBin = treeService.getDescendantNode(rootNode, -20);
                    if (recycleBin) {
                        recycleBin.hasChildren = true;
                        //reload the recycle bin if it's already expanded so the deleted item is shown
                        if (recycleBin.expanded) {
                            treeService.loadNodeChildren({
                                node: recycleBin,
                                section: 'content'
                            });
                        }
                    }
                }
                //if the current edited item is the same one as we're deleting, we need to navigate elsewhere
                if (editorState.current && editorState.current.id == $scope.currentNode.id) {
                    //If the deleted item lived at the root then just redirect back to the root, otherwise redirect to the item's parent
                    var location = '/content';
                    if ($scope.currentNode.parentId.toString() === '-20')
                        location = '/content/content/recyclebin';
                    else if ($scope.currentNode.parentId.toString() !== '-1')
                        location = '/content/content/edit/' + $scope.currentNode.parentId;
                    $location.path(location);
                }
                navigationService.hideMenu();
            }, function (err) {
                toggleDeleting(false);
                //check if response is ysod
                if (err.status && err.status >= 500) {
                    overlayService.ysod(err);
                }
            });
        };
        $scope.cancel = function () {
            toggleDeleting(false);
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.Content.DeleteController', ContentDeleteController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Content.EditController
 * @function
 * 
 * @description
 * The controller for the content editor
 */
    function ContentEditController($scope, $rootScope, $routeParams, contentResource) {
        var infiniteMode = $scope.model && $scope.model.infiniteMode;
        function scaffoldEmpty() {
            return contentResource.getScaffold($routeParams.id, $routeParams.doctype);
        }
        function scaffoldBlueprint() {
            return contentResource.getBlueprintScaffold($routeParams.id, $routeParams.blueprintId);
        }
        $scope.contentId = infiniteMode ? $scope.model.id : $routeParams.id;
        $scope.saveMethod = contentResource.save;
        $scope.getMethod = contentResource.getById;
        $scope.getScaffoldMethod = $routeParams.blueprintId ? scaffoldBlueprint : scaffoldEmpty;
        $scope.page = $routeParams.page;
        $scope.isNew = infiniteMode ? $scope.model.create : $routeParams.create;
        //load the default culture selected in the main tree if any
        $scope.culture = $routeParams.cculture ? $routeParams.cculture : $routeParams.mculture;
        //Bind to $routeUpdate which will execute anytime a location changes but the route is not triggered.
        //This is so we can listen to changes on the cculture parameter since that will not cause a route change
        // and then we can pass in the updated culture to the editor
        $scope.$on('$routeUpdate', function (event, next) {
            $scope.culture = next.params.cculture ? next.params.cculture : $routeParams.mculture;
        });
    }
    angular.module('umbraco').controller('Umbraco.Editors.Content.EditController', ContentEditController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Content.EmptyRecycleBinController
 * @function
 * 
 * @description
 * The controller for deleting content
 */
    function ContentEmptyRecycleBinController($scope, contentResource, treeService, navigationService, notificationsService, $route) {
        $scope.busy = false;
        $scope.performDelete = function () {
            //(used in the UI)
            $scope.busy = true;
            $scope.currentNode.loading = true;
            contentResource.emptyRecycleBin($scope.currentNode.id).then(function (result) {
                $scope.busy = false;
                $scope.currentNode.loading = false;
                treeService.removeChildNodes($scope.currentNode);
                navigationService.hideMenu();
                //reload the current view
                $route.reload();
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.Content.EmptyRecycleBinController', ContentEmptyRecycleBinController);
    'use strict';
    angular.module('umbraco').controller('Umbraco.Editors.Content.MoveController', function ($scope, userService, eventsService, contentResource, navigationService, appState, treeService, localizationService, notificationsService) {
        var searchText = 'Search...';
        localizationService.localize('general_search').then(function (value) {
            searchText = value + '...';
        });
        $scope.dialogTreeApi = {};
        $scope.busy = false;
        $scope.searchInfo = {
            searchFromId: null,
            searchFromName: null,
            showSearch: false,
            results: [],
            selectedSearchResults: []
        };
        $scope.treeModel = { hideHeader: false };
        userService.getCurrentUser().then(function (userData) {
            $scope.treeModel.hideHeader = userData.startContentIds.length > 0 && userData.startContentIds.indexOf(-1) == -1;
        });
        $scope.source = _.clone($scope.currentNode);
        function treeLoadedHandler(args) {
            if ($scope.source && $scope.source.path) {
                $scope.dialogTreeApi.syncTree({
                    path: $scope.source.path,
                    activate: false
                });
            }
        }
        function nodeSelectHandler(args) {
            if (args && args.event) {
                args.event.preventDefault();
                args.event.stopPropagation();
            }
            eventsService.emit('editors.content.moveController.select', args);
            if ($scope.target) {
                //un-select if there's a current one selected
                $scope.target.selected = false;
            }
            $scope.target = args.node;
            $scope.target.selected = true;
        }
        function nodeExpandedHandler(args) {
            // open mini list view for list views
            if (args.node.metaData.isContainer) {
                openMiniListView(args.node);
            }
        }
        $scope.hideSearch = function () {
            $scope.searchInfo.showSearch = false;
            $scope.searchInfo.searchFromId = null;
            $scope.searchInfo.searchFromName = null;
            $scope.searchInfo.results = [];
        };
        // method to select a search result 
        $scope.selectResult = function (evt, result) {
            result.selected = result.selected === true ? false : true;
            nodeSelectHandler(evt, {
                event: evt,
                node: result
            });
        };
        //callback when there are search results 
        $scope.onSearchResults = function (results) {
            $scope.searchInfo.results = results;
            $scope.searchInfo.showSearch = true;
        };
        $scope.close = function () {
            navigationService.hideDialog();
        };
        $scope.move = function () {
            $scope.busy = true;
            $scope.error = false;
            contentResource.move({
                parentId: $scope.target.id,
                id: $scope.source.id
            }).then(function (path) {
                $scope.error = false;
                $scope.success = true;
                $scope.busy = false;
                //first we need to remove the node that launched the dialog
                treeService.removeNode($scope.currentNode);
                //get the currently edited node (if any)
                var activeNode = appState.getTreeState('selectedNode');
                //we need to do a double sync here: first sync to the moved content - but don't activate the node,
                //then sync to the currently edited content (note: this might not be the content that was moved!!)
                navigationService.syncTree({
                    tree: 'content',
                    path: path,
                    forceReload: true,
                    activate: false
                }).then(function (args) {
                    if (activeNode) {
                        var activeNodePath = treeService.getPath(activeNode).join();
                        //sync to this node now - depending on what was copied this might already be synced but might not be
                        navigationService.syncTree({
                            tree: 'content',
                            path: activeNodePath,
                            forceReload: false,
                            activate: true
                        });
                    }
                });
            }, function (err) {
                $scope.success = false;
                $scope.error = err;
                $scope.busy = false;
            });
        };
        $scope.onTreeInit = function () {
            $scope.dialogTreeApi.callbacks.treeLoaded(treeLoadedHandler);
            $scope.dialogTreeApi.callbacks.treeNodeSelect(nodeSelectHandler);
            $scope.dialogTreeApi.callbacks.treeNodeExpanded(nodeExpandedHandler);
        };
        // Mini list view
        $scope.selectListViewNode = function (node) {
            node.selected = node.selected === true ? false : true;
            nodeSelectHandler({}, { node: node });
        };
        $scope.closeMiniListView = function () {
            $scope.miniListView = undefined;
        };
        function openMiniListView(node) {
            $scope.miniListView = node;
        }
    });
    'use strict';
    (function () {
        function CreateNotifyController($scope, contentResource, navigationService, angularHelper, localizationService) {
            var vm = this;
            var currentForm;
            vm.notifyOptions = [];
            vm.save = save;
            vm.cancel = cancel;
            vm.message = { name: $scope.currentNode.name };
            vm.labels = {};
            function onInit() {
                vm.loading = true;
                contentResource.getNotifySettingsById($scope.currentNode.id).then(function (options) {
                    currentForm = angularHelper.getCurrentForm($scope);
                    vm.loading = false;
                    vm.notifyOptions = options;
                });
                localizationService.localize('notifications_editNotifications', [$scope.currentNode.name]).then(function (value) {
                    vm.labels.headline = value;
                });
            }
            function cancel() {
                navigationService.hideMenu();
            }
            ;
            function save(notifyOptions) {
                vm.saveState = 'busy';
                vm.saveError = false;
                vm.saveSuccces = false;
                var selectedString = [];
                angular.forEach(notifyOptions, function (option) {
                    if (option.checked === true && option.notifyCode) {
                        selectedString.push(option.notifyCode);
                    }
                });
                contentResource.setNotifySettingsById($scope.currentNode.id, selectedString).then(function () {
                    vm.saveState = 'success';
                    vm.saveSuccces = true;
                }, function (error) {
                    vm.saveState = 'error';
                    vm.saveError = error;
                });
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Content.CreateNotifyController', CreateNotifyController);
    }());
    'use strict';
    (function () {
        'use strict';
        function ContentProtectController($scope, $q, contentResource, memberResource, memberGroupResource, navigationService, localizationService, editorService) {
            var vm = this;
            var id = $scope.currentNode.id;
            vm.loading = false;
            vm.buttonState = 'init';
            vm.isValid = isValid;
            vm.next = next;
            vm.save = save;
            vm.close = close;
            vm.toggle = toggle;
            vm.pickLoginPage = pickLoginPage;
            vm.pickErrorPage = pickErrorPage;
            vm.pickGroup = pickGroup;
            vm.removeGroup = removeGroup;
            vm.pickMember = pickMember;
            vm.removeMember = removeMember;
            vm.removeProtection = removeProtection;
            vm.removeProtectionConfirm = removeProtectionConfirm;
            vm.type = null;
            vm.step = null;
            function onInit() {
                vm.loading = true;
                // get the current public access protection
                contentResource.getPublicAccess(id).then(function (publicAccess) {
                    vm.loading = false;
                    // init the current settings for public access (if any)
                    vm.loginPage = publicAccess.loginPage;
                    vm.errorPage = publicAccess.errorPage;
                    vm.groups = publicAccess.groups || [];
                    vm.members = publicAccess.members || [];
                    vm.canRemove = true;
                    if (vm.members.length) {
                        vm.type = 'member';
                        next();
                    } else if (vm.groups.length) {
                        vm.type = 'group';
                        next();
                    } else {
                        vm.canRemove = false;
                    }
                });
            }
            function next() {
                if (vm.type === 'group') {
                    vm.loading = true;
                    // get all existing member groups for lookup upon selection
                    // NOTE: if/when member groups support infinite editing, we can't rely on using a cached lookup list of valid groups anymore
                    memberGroupResource.getGroups().then(function (groups) {
                        vm.step = vm.type;
                        vm.allGroups = groups;
                        vm.hasGroups = groups.length > 0;
                        vm.loading = false;
                    });
                } else {
                    vm.step = vm.type;
                }
            }
            function isValid() {
                if (!vm.type) {
                    return false;
                }
                if (!vm.protectForm.$valid) {
                    return false;
                }
                if (!vm.loginPage || !vm.errorPage) {
                    return false;
                }
                if (vm.type === 'group') {
                    return vm.groups && vm.groups.length > 0;
                }
                if (vm.type === 'member') {
                    return vm.members && vm.members.length > 0;
                }
                return true;
            }
            function save() {
                vm.buttonState = 'busy';
                var groups = _.map(vm.groups, function (group) {
                    return group.name;
                });
                var usernames = _.map(vm.members, function (member) {
                    return member.username;
                });
                contentResource.updatePublicAccess(id, groups, usernames, vm.loginPage.id, vm.errorPage.id).then(function () {
                    localizationService.localize('publicAccess_paIsProtected', [$scope.currentNode.name]).then(function (value) {
                        vm.success = { message: value };
                    });
                    navigationService.syncTree({
                        tree: 'content',
                        path: $scope.currentNode.path,
                        forceReload: true
                    });
                }, function (error) {
                    vm.error = error;
                    vm.buttonState = 'error';
                });
            }
            function close() {
                // ensure that we haven't set a locked state on the dialog before closing it
                navigationService.allowHideDialog(true);
                navigationService.hideDialog();
            }
            function toggle(group) {
                group.selected = !group.selected;
            }
            function pickGroup() {
                navigationService.allowHideDialog(false);
                editorService.memberGroupPicker({
                    multiPicker: true,
                    submit: function submit(model) {
                        var selectedGroupIds = model.selectedMemberGroups ? model.selectedMemberGroups : [model.selectedMemberGroup];
                        _.each(selectedGroupIds, function (groupId) {
                            // find the group in the lookup list and add it if it isn't already
                            var group = _.find(vm.allGroups, function (g) {
                                return g.id === parseInt(groupId);
                            });
                            if (group && !_.find(vm.groups, function (g) {
                                    return g.id === group.id;
                                })) {
                                vm.groups.push(group);
                            }
                        });
                        editorService.close();
                        navigationService.allowHideDialog(true);
                    },
                    close: function close() {
                        editorService.close();
                        navigationService.allowHideDialog(true);
                    }
                });
            }
            function removeGroup(group) {
                vm.groups = _.reject(vm.groups, function (g) {
                    return g.id === group.id;
                });
            }
            function pickMember() {
                navigationService.allowHideDialog(false);
                // TODO: once editorService has a memberPicker method, use that instead
                editorService.treePicker({
                    multiPicker: true,
                    entityType: 'Member',
                    section: 'member',
                    treeAlias: 'member',
                    filter: function filter(i) {
                        return i.metaData.isContainer;
                    },
                    filterCssClass: 'not-allowed',
                    submit: function submit(model) {
                        if (model.selection && model.selection.length) {
                            var promises = [];
                            // get the selected member usernames
                            _.each(model.selection, function (member) {
                                // TODO:
                                // as-is we need to fetch all the picked members one at a time to get their usernames.
                                // when editorService has a memberPicker method, see if this can't be avoided - otherwise
                                // add a memberResource.getByKeys() method to do all this in one request
                                promises.push(memberResource.getByKey(member.key).then(function (newMember) {
                                    if (!_.find(vm.members, function (currentMember) {
                                            return currentMember.username === newMember.username;
                                        })) {
                                        vm.members.push(newMember);
                                    }
                                }));
                            });
                            editorService.close();
                            navigationService.allowHideDialog(true);
                            // wait for all the member lookups to complete 
                            vm.loading = true;
                            $q.all(promises).then(function () {
                                vm.loading = false;
                            });
                        }
                    },
                    close: function close() {
                        editorService.close();
                        navigationService.allowHideDialog(true);
                    }
                });
            }
            function removeMember(member) {
                vm.members = _.without(vm.members, member);
            }
            function pickLoginPage() {
                pickPage(vm.loginPage);
            }
            function pickErrorPage() {
                pickPage(vm.errorPage);
            }
            function pickPage(page) {
                navigationService.allowHideDialog(false);
                editorService.contentPicker({
                    submit: function submit(model) {
                        if (page === vm.loginPage) {
                            vm.loginPage = model.selection[0];
                        } else {
                            vm.errorPage = model.selection[0];
                        }
                        editorService.close();
                        navigationService.allowHideDialog(true);
                    },
                    close: function close() {
                        editorService.close();
                        navigationService.allowHideDialog(true);
                    }
                });
            }
            function removeProtection() {
                vm.removing = true;
            }
            function removeProtectionConfirm() {
                vm.buttonState = 'busy';
                contentResource.removePublicAccess(id).then(function () {
                    localizationService.localize('publicAccess_paIsRemoved', [$scope.currentNode.name]).then(function (value) {
                        vm.success = { message: value };
                    });
                    navigationService.syncTree({
                        tree: 'content',
                        path: $scope.currentNode.path,
                        forceReload: true
                    });
                }, function (error) {
                    vm.error = error;
                    vm.buttonState = 'error';
                });
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Content.ProtectController', ContentProtectController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Content.RecycleBinController
 * @function
 * 
 * @description
 * Controls the recycle bin for content
 * 
 */
    function ContentRecycleBinController($scope, $routeParams, contentResource, navigationService, localizationService) {
        //ensures the list view doesn't actually load until we query for the list view config
        // for the section
        $scope.page = {};
        $scope.page.name = 'Recycle Bin';
        $scope.page.nameLocked = true;
        //ensures the list view doesn't actually load until we query for the list view config
        // for the section
        $scope.listViewPath = null;
        $routeParams.id = '-20';
        contentResource.getRecycleBin().then(function (result) {
            $scope.content = result;
        });
        // sync tree node
        navigationService.syncTree({
            tree: 'content',
            path: [
                '-1',
                $routeParams.id
            ],
            forceReload: false
        });
        localizePageName();
        function localizePageName() {
            var pageName = 'general_recycleBin';
            localizationService.localize(pageName).then(function (value) {
                $scope.page.name = value;
            });
        }
    }
    angular.module('umbraco').controller('Umbraco.Editors.Content.RecycleBinController', ContentRecycleBinController);
    'use strict';
    angular.module('umbraco').controller('Umbraco.Editors.Content.RestoreController', function ($scope, relationResource, contentResource, entityResource, navigationService, appState, treeService, localizationService) {
        $scope.source = _.clone($scope.currentNode);
        $scope.error = null;
        $scope.success = false;
        $scope.loading = true;
        relationResource.getByChildId($scope.source.id, 'relateParentDocumentOnDelete').then(function (data) {
            $scope.loading = false;
            if (!data.length) {
                localizationService.localizeMany([
                    'recycleBin_itemCannotBeRestored',
                    'recycleBin_noRestoreRelation'
                ]).then(function (values) {
                    $scope.success = false;
                    $scope.error = {
                        errorMsg: values[0],
                        data: { Message: values[1] }
                    };
                });
                return;
            }
            $scope.relation = data[0];
            if ($scope.relation.parentId === -1) {
                $scope.target = {
                    id: -1,
                    name: 'Root'
                };
            } else {
                $scope.loading = true;
                entityResource.getById($scope.relation.parentId, 'Document').then(function (data) {
                    $scope.loading = false;
                    $scope.target = data;
                    // make sure the target item isn't in the recycle bin
                    if ($scope.target.path.indexOf('-20') !== -1) {
                        localizationService.localizeMany([
                            'recycleBin_itemCannotBeRestored',
                            'recycleBin_restoreUnderRecycled'
                        ]).then(function (values) {
                            $scope.success = false;
                            $scope.error = {
                                errorMsg: values[0],
                                data: { Message: values[1].replace('%0%', $scope.target.name) }
                            };
                        });
                        $scope.success = false;
                    }
                }, function (err) {
                    $scope.success = false;
                    $scope.error = err;
                    $scope.loading = false;
                });
            }
        }, function (err) {
            $scope.success = false;
            $scope.error = err;
        });
        $scope.restore = function () {
            $scope.loading = true;
            // this code was copied from `content.move.controller.js`
            contentResource.move({
                parentId: $scope.target.id,
                id: $scope.source.id
            }).then(function (path) {
                $scope.loading = false;
                $scope.success = true;
                //first we need to remove the node that launched the dialog
                treeService.removeNode($scope.currentNode);
                //get the currently edited node (if any)
                var activeNode = appState.getTreeState('selectedNode');
                //we need to do a double sync here: first sync to the moved content - but don't activate the node,
                //then sync to the currenlty edited content (note: this might not be the content that was moved!!)
                navigationService.syncTree({
                    tree: 'content',
                    path: path,
                    forceReload: true,
                    activate: false
                }).then(function (args) {
                    if (activeNode) {
                        var activeNodePath = treeService.getPath(activeNode).join();
                        //sync to this node now - depending on what was copied this might already be synced but might not be
                        navigationService.syncTree({
                            tree: 'content',
                            path: activeNodePath,
                            forceReload: false,
                            activate: true
                        });
                    }
                });
            }, function (err) {
                $scope.success = false;
                $scope.error = err;
                $scope.loading = false;
            });
        };
        $scope.close = function () {
            navigationService.hideDialog();
        };
    });
    'use strict';
    (function () {
        'use strict';
        function ContentRightsController($scope, $timeout, contentResource, localizationService, angularHelper, navigationService) {
            var vm = this;
            var currentForm;
            vm.availableUserGroups = [];
            vm.selectedUserGroups = [];
            vm.removedUserGroups = [];
            vm.viewState = 'manageGroups';
            vm.labels = {};
            vm.showNotification = false;
            vm.setViewSate = setViewSate;
            vm.editPermissions = editPermissions;
            vm.setPermissions = setPermissions;
            vm.save = save;
            vm.removePermissions = removePermissions;
            vm.cancelManagePermissions = cancelManagePermissions;
            vm.closeDialog = closeDialog;
            vm.stay = stay;
            vm.discardChanges = discardChanges;
            function onInit() {
                vm.loading = true;
                contentResource.getDetailedPermissions($scope.currentNode.id).then(function (userGroups) {
                    initData(userGroups);
                    vm.loading = false;
                    currentForm = angularHelper.getCurrentForm($scope);
                });
            }
            /**
    * This will initialize the data and set the correct selectedUserGroups based on the default permissions and explicit permissions assigned
    * @param {any} userGroups
    */
            function initData(userGroups) {
                //reset this
                vm.selectedUserGroups = [];
                vm.availableUserGroups = userGroups;
                angular.forEach(vm.availableUserGroups, function (group) {
                    if (group.permissions) {
                        //if there's explicit permissions assigned than it's selected
                        assignGroupPermissions(group);
                    }
                });
            }
            function setViewSate(state) {
                vm.viewState = state;
            }
            function editPermissions(group) {
                vm.selectedUserGroup = group;
                if (!vm.selectedUserGroup.permissions) {
                    //if no permissions are explicitly set this means we need to show the defaults
                    vm.selectedUserGroup.permissions = vm.selectedUserGroup.defaultPermissions;
                }
                localizationService.localize('defaultdialogs_permissionsSetForGroup', [
                    $scope.currentNode.name,
                    vm.selectedUserGroup.name
                ]).then(function (value) {
                    vm.labels.permissionsSetForGroup = value;
                });
                setViewSate('managePermissions');
                // hide dropdown
                vm.groupsDropdownOpen = false;
            }
            function assignGroupPermissions(group) {
                // clear allowed permissions before we make the list so we don't have duplicates
                group.allowedPermissions = [];
                // get list of checked permissions
                angular.forEach(group.permissions, function (permissionGroup) {
                    angular.forEach(permissionGroup, function (permission) {
                        if (permission.checked) {
                            //the `allowedPermissions` is what will get sent up to the server for saving
                            group.allowedPermissions.push(permission);
                        }
                    });
                });
                if (!group.selected) {
                    // set to selected so we can remove from the dropdown easily
                    group.selected = true;
                    vm.selectedUserGroups.push(group);
                    //remove from the removed groups if it's been re-added
                    vm.removedUserGroups = _.reject(vm.removedUserGroups, function (g) {
                        return g.id == group.id;
                    });
                }
            }
            function setPermissions(group) {
                assignGroupPermissions(group);
                setViewSate('manageGroups');
            }
            /**
     * This essentially resets the permissions for a group for this content item, it will remove it from the selected list
     * @param {any} index
     */
            function removePermissions(index) {
                // remove as selected so we can select it from the dropdown again
                var group = vm.selectedUserGroups[index];
                group.selected = false;
                //reset assigned permissions - so it will default back to default permissions
                group.permissions = [];
                group.allowedPermissions = [];
                vm.selectedUserGroups.splice(index, 1);
                //track it in the removed so this gets pushed to the server
                vm.removedUserGroups.push(group);
            }
            function cancelManagePermissions() {
                setViewSate('manageGroups');
            }
            function formatSaveModel(permissionsSave, groupCollection) {
                angular.forEach(groupCollection, function (g) {
                    permissionsSave[g.id] = [];
                    angular.forEach(g.allowedPermissions, function (p) {
                        permissionsSave[g.id].push(p.permissionCode);
                    });
                });
            }
            function save() {
                vm.saveState = 'busy';
                vm.saveError = false;
                vm.saveSuccces = false;
                //this is a dictionary that we need to populate
                var permissionsSave = {};
                //format the selectedUserGroups, then the removedUserGroups since we want to pass data from both collections up
                formatSaveModel(permissionsSave, vm.selectedUserGroups);
                formatSaveModel(permissionsSave, vm.removedUserGroups);
                var saveModel = {
                    contentId: $scope.currentNode.id,
                    permissions: permissionsSave
                };
                contentResource.savePermissions(saveModel).then(function (userGroups) {
                    //re-assign model from server since it could have changed
                    initData(userGroups);
                    // clear dirty state on the form so we don't see the discard changes notification
                    // we use a timeout here because in some cases the initData reformats the userGroups model and triggers a change after the form state was changed
                    $timeout(function () {
                        if (currentForm) {
                            currentForm.$dirty = false;
                        }
                    });
                    vm.saveState = 'success';
                    vm.saveSuccces = true;
                }, function (error) {
                    vm.saveState = 'error';
                    vm.saveError = error;
                });
            }
            function stay() {
                vm.showNotification = false;
            }
            function closeDialog() {
                // check if form has been changed. If it has show discard changes notification
                if (currentForm && currentForm.$dirty) {
                    vm.showNotification = true;
                } else {
                    navigationService.hideDialog();
                }
            }
            function discardChanges() {
                navigationService.hideDialog();
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Content.RightsController', ContentRightsController);
    }());
    'use strict';
    (function () {
        'use strict';
        function ContentSortController($scope, $filter, $routeParams, contentResource, navigationService) {
            var vm = this;
            var parentId = $scope.currentNode.parentId ? $scope.currentNode.parentId : '-1';
            var id = $scope.currentNode.id;
            vm.loading = false;
            vm.children = [];
            vm.saveButtonState = 'init';
            vm.sortOrder = {};
            vm.sortableOptions = {
                distance: 10,
                tolerance: 'pointer',
                opacity: 0.7,
                scroll: true,
                cursor: 'move',
                helper: fixSortableHelper,
                update: function update() {
                    // clear the sort order when drag and drop is used
                    vm.sortOrder.column = '';
                    vm.sortOrder.reverse = false;
                }
            };
            vm.save = save;
            vm.sort = sort;
            vm.close = close;
            function onInit() {
                vm.loading = true;
                contentResource.getChildren(id, { cultureName: $routeParams.cculture ? $routeParams.cculture : $routeParams.mculture }).then(function (data) {
                    vm.children = data.items;
                    vm.loading = false;
                });
            }
            function save() {
                vm.saveButtonState = 'busy';
                var args = {
                    parentId: parentId,
                    sortedIds: _.map(vm.children, function (child) {
                        return child.id;
                    })
                };
                contentResource.sort(args).then(function () {
                    navigationService.syncTree({
                        tree: 'content',
                        path: $scope.currentNode.path,
                        forceReload: true
                    }).then(function () {
                        return navigationService.reloadNode($scope.currentNode);
                    });
                    vm.saveButtonState = 'success';
                }, function (error) {
                    vm.error = error;
                    vm.saveButtonState = 'error';
                });
            }
            function fixSortableHelper(e, ui) {
                // keep the correct width of each table cell when sorting
                ui.children().each(function () {
                    $(this).width($(this).width());
                });
                return ui;
            }
            function sort(column) {
                // reverse if it is already ordered by that column
                if (vm.sortOrder.column === column) {
                    vm.sortOrder.reverse = !vm.sortOrder.reverse;
                } else {
                    vm.sortOrder.column = column;
                    vm.sortOrder.reverse = false;
                }
                vm.children = $filter('orderBy')(vm.children, vm.sortOrder.column, vm.sortOrder.reverse);
            }
            function close() {
                navigationService.hideDialog();
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Content.SortController', ContentSortController);
    }());
    'use strict';
    (function () {
        'use strict';
        function PublishController($scope, localizationService) {
            var vm = this;
            vm.loading = true;
            vm.hasPristineVariants = false;
            vm.changeSelection = changeSelection;
            vm.dirtyVariantFilter = dirtyVariantFilter;
            vm.pristineVariantFilter = pristineVariantFilter;
            /** Returns true if publishing is possible based on if there are un-published mandatory languages */
            function canPublish() {
                var selected = [];
                for (var i = 0; i < vm.variants.length; i++) {
                    var variant = vm.variants[i];
                    //if this variant will show up in the publish-able list
                    var publishable = dirtyVariantFilter(variant);
                    var published = !(variant.state === 'NotCreated' || variant.state === 'Draft');
                    if (variant.language.isMandatory && !published && (!publishable || !variant.publish)) {
                        //if a mandatory variant isn't published 
                        //and it's not publishable or not selected to be published
                        //then we cannot continue
                        //TODO: Show a message when this occurs
                        return false;
                    }
                    if (variant.publish) {
                        selected.push(variant.publish);
                    }
                }
                return selected.length > 0;
            }
            function changeSelection(variant) {
                $scope.model.disableSubmitButton = !canPublish();
                //need to set the Save state to true if publish is true
                variant.save = variant.publish;
            }
            function dirtyVariantFilter(variant) {
                //determine a variant is 'dirty' (meaning it will show up as publish-able) if it's
                // * the active one
                // * it's editor is in a $dirty state
                // * it has pending saves
                // * it is unpublished
                // * it is in NotCreated state
                return variant.active || variant.isDirty || variant.state === 'Draft' || variant.state === 'PublishedPendingChanges' || variant.state === 'NotCreated';
            }
            function pristineVariantFilter(variant) {
                return !dirtyVariantFilter(variant);
            }
            function onInit() {
                vm.variants = $scope.model.variants;
                if (!$scope.model.title) {
                    localizationService.localize('content_readyToPublish').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                vm.hasPristineVariants = false;
                _.each(vm.variants, function (variant) {
                    variant.compositeId = variant.language.culture + '_' + (variant.segment ? variant.segment : '');
                    variant.htmlId = '_content_variant_' + variant.compositeId;
                    //check for pristine variants
                    if (!vm.hasPristineVariants) {
                        vm.hasPristineVariants = pristineVariantFilter(variant);
                    }
                });
                if (vm.variants.length !== 0) {
                    //now sort it so that the current one is at the top
                    vm.variants = _.sortBy(vm.variants, function (v) {
                        return v.active ? 0 : 1;
                    });
                    var active = _.find(vm.variants, function (v) {
                        return v.active;
                    });
                    if (active) {
                        //ensure that the current one is selected
                        active.publish = true;
                        active.save = true;
                    }
                    $scope.model.disableSubmitButton = !canPublish();
                } else {
                    //disable Publish button if we have nothing to publish, should not happen
                    $scope.model.disableSubmitButton = true;
                }
                vm.loading = false;
            }
            onInit();
            //when this dialog is closed, reset all 'publish' flags
            $scope.$on('$destroy', function () {
                for (var i = 0; i < vm.variants.length; i++) {
                    vm.variants[i].publish = false;
                    vm.variants[i].save = false;
                }
            });
        }
        angular.module('umbraco').controller('Umbraco.Overlays.PublishController', PublishController);
    }());
    'use strict';
    (function () {
        'use strict';
        function PublishDescendantsController($scope, localizationService) {
            var vm = this;
            vm.changeSelection = changeSelection;
            function onInit() {
                vm.includeUnpublished = false;
                vm.variants = $scope.model.variants;
                vm.labels = {};
                if (!$scope.model.title) {
                    localizationService.localize('buttons_publishDescendants').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                _.each(vm.variants, function (variant) {
                    variant.compositeId = (variant.language ? variant.language.culture : 'inv') + '_' + (variant.segment ? variant.segment : '');
                    variant.htmlId = '_content_variant_' + variant.compositeId;
                });
                if (vm.variants.length > 1) {
                    //now sort it so that the current one is at the top
                    vm.variants = _.sortBy(vm.variants, function (v) {
                        return v.active ? 0 : 1;
                    });
                    var active = _.find(vm.variants, function (v) {
                        return v.active;
                    });
                    if (active) {
                        //ensure that the current one is selected
                        active.publish = true;
                        active.save = true;
                    }
                    $scope.model.disableSubmitButton = !canPublish();
                } else {
                    // localize help text for invariant content
                    vm.labels.help = {
                        'key': 'content_publishDescendantsHelp',
                        'tokens': []
                    };
                    // add the node name as a token so it will show up in the translated text
                    vm.labels.help.tokens.push(vm.variants[0].name);
                }
            }
            /** Returns true if publishing is possible based on if there are un-published mandatory languages */
            function canPublish() {
                var selected = [];
                for (var i = 0; i < vm.variants.length; i++) {
                    var variant = vm.variants[i];
                    var published = !(variant.state === 'NotCreated' || variant.state === 'Draft');
                    if (variant.language.isMandatory && !published && !variant.publish) {
                        //if a mandatory variant isn't published 
                        //and not flagged for saving
                        //then we cannot continue
                        //TODO: Show a message when this occurs
                        return false;
                    }
                    if (variant.publish) {
                        selected.push(variant.publish);
                    }
                }
                return selected.length > 0;
            }
            function changeSelection(variant) {
                $scope.model.disableSubmitButton = !canPublish();
                //need to set the Save state to true if publish is true
                variant.save = variant.publish;
            }
            //when this dialog is closed, reset all 'publish' flags
            $scope.$on('$destroy', function () {
                for (var i = 0; i < vm.variants.length; i++) {
                    vm.variants[i].publish = false;
                    vm.variants[i].save = false;
                }
            });
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Overlays.PublishDescendantsController', PublishDescendantsController);
    }());
    'use strict';
    (function () {
        'use strict';
        function SaveContentController($scope, localizationService) {
            var vm = this;
            vm.loading = true;
            vm.hasPristineVariants = false;
            vm.changeSelection = changeSelection;
            vm.dirtyVariantFilter = dirtyVariantFilter;
            vm.pristineVariantFilter = pristineVariantFilter;
            function changeSelection(variant) {
                var firstSelected = _.find(vm.variants, function (v) {
                    return v.save;
                });
                $scope.model.disableSubmitButton = !firstSelected;    //disable submit button if there is none selected
            }
            function dirtyVariantFilter(variant) {
                //determine a variant is 'dirty' (meaning it will show up as save-able) if it's
                // * the active one
                // * it's editor is in a $dirty state
                // * it is in NotCreated state
                return variant.active || variant.isDirty;
            }
            function pristineVariantFilter(variant) {
                return !dirtyVariantFilter(variant);
            }
            function onInit() {
                vm.variants = $scope.model.variants;
                if (!$scope.model.title) {
                    localizationService.localize('content_readyToSave').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                vm.hasPristineVariants = false;
                _.each(vm.variants, function (variant) {
                    variant.compositeId = variant.language.culture + '_' + (variant.segment ? variant.segment : '');
                    variant.htmlId = '_content_variant_' + variant.compositeId;
                    //check for pristine variants
                    if (!vm.hasPristineVariants) {
                        vm.hasPristineVariants = pristineVariantFilter(variant);
                    }
                });
                if (vm.variants.length !== 0) {
                    //now sort it so that the current one is at the top
                    vm.variants = _.sortBy(vm.variants, function (v) {
                        return v.active ? 0 : 1;
                    });
                    var active = _.find(vm.variants, function (v) {
                        return v.active;
                    });
                    if (active) {
                        //ensure that the current one is selected
                        active.save = true;
                    }
                } else {
                    //disable save button if we have nothing to save
                    $scope.model.disableSubmitButton = true;
                }
                vm.loading = false;
            }
            onInit();
            //when this dialog is closed, reset all 'save' flags
            $scope.$on('$destroy', function () {
                for (var i = 0; i < vm.variants.length; i++) {
                    vm.variants[i].save = false;
                }
            });
        }
        angular.module('umbraco').controller('Umbraco.Overlays.SaveContentController', SaveContentController);
    }());
    'use strict';
    (function () {
        'use strict';
        function ScheduleContentController($scope, $timeout, localizationService, dateHelper, userService) {
            var vm = this;
            vm.datePickerSetup = datePickerSetup;
            vm.datePickerChange = datePickerChange;
            vm.datePickerShow = datePickerShow;
            vm.datePickerClose = datePickerClose;
            vm.clearPublishDate = clearPublishDate;
            vm.clearUnpublishDate = clearUnpublishDate;
            vm.dirtyVariantFilter = dirtyVariantFilter;
            vm.pristineVariantFilter = pristineVariantFilter;
            vm.changeSelection = changeSelection;
            vm.firstSelectedDates = {};
            vm.currentUser = null;
            //used to track the original values so if the user doesn't save the schedule and they close the dialog we reset the dates back to what they were.
            var origDates = [];
            function onInit() {
                vm.variants = $scope.model.variants;
                vm.hasPristineVariants = false;
                for (var i = 0; i < vm.variants.length; i++) {
                    origDates.push({
                        releaseDate: vm.variants[i].releaseDate,
                        expireDate: vm.variants[i].expireDate
                    });
                }
                if (!$scope.model.title) {
                    localizationService.localize('general_scheduledPublishing').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                // Check for variants: if a node is invariant it will still have the default language in variants
                // so we have to check for length > 1
                if (vm.variants.length > 1) {
                    _.each(vm.variants, function (variant) {
                        variant.compositeId = variant.language.culture + '_' + (variant.segment ? variant.segment : '');
                        variant.htmlId = '_content_variant_' + variant.compositeId;
                        //check for pristine variants
                        if (!vm.hasPristineVariants) {
                            vm.hasPristineVariants = pristineVariantFilter(variant);
                        }
                    });
                    //now sort it so that the current one is at the top
                    vm.variants = _.sortBy(vm.variants, function (v) {
                        return v.active ? 0 : 1;
                    });
                    var active = _.find(vm.variants, function (v) {
                        return v.active;
                    });
                    if (active) {
                        //ensure that the current one is selected
                        active.save = true;
                    }
                    $scope.model.disableSubmitButton = !canSchedule();
                }
                // get current backoffice user and format dates
                userService.getCurrentUser().then(function (currentUser) {
                    vm.currentUser = currentUser;
                    angular.forEach(vm.variants, function (variant) {
                        // prevent selecting publish/unpublish date before today
                        var now = new Date();
                        var nowFormatted = moment(now).format('YYYY-MM-DD HH:mm');
                        var datePickerConfig = {
                            enableTime: true,
                            dateFormat: 'Y-m-d H:i',
                            time_24hr: true,
                            minDate: nowFormatted,
                            defaultDate: nowFormatted
                        };
                        variant.datePickerConfig = datePickerConfig;
                        // format all dates to local
                        if (variant.releaseDate || variant.expireDate) {
                            formatDatesToLocal(variant);
                        }
                    });
                });
            }
            /**
     * Callback when date is set up
     * @param {any} variant
     * @param {any} type publish or unpublish 
     * @param {any} datePickerInstance The date picker instance
     */
            function datePickerSetup(variant, type, datePickerInstance) {
                // store a date picker instance for publish and unpublish picker
                // so we can change the settings independently.
                if (type === 'publish') {
                    variant.releaseDatePickerInstance = datePickerInstance;
                } else if (type === 'unpublish') {
                    variant.expireDatePickerInstance = datePickerInstance;
                }
                $scope.model.disableSubmitButton = !canSchedule();
            }
            ;
            /**
     * Callback when date picker date changes
     * @param {any} variant 
     * @param {any} dateStr Date string from the date picker
     * @param {any} type publish or unpublish
     */
            function datePickerChange(variant, dateStr, type) {
                if (type === 'publish') {
                    setPublishDate(variant, dateStr);
                } else if (type === 'unpublish') {
                    setUnpublishDate(variant, dateStr);
                }
                $scope.model.disableSubmitButton = !canSchedule();
            }
            /**
     * Add flag when a date picker opens is we can prevent the overlay from closing
     * @param {any} variant 
     * @param {any} type publish or unpublish
     */
            function datePickerShow(variant, type) {
                if (type === 'publish') {
                    variant.releaseDatePickerOpen = true;
                } else if (type === 'unpublish') {
                    variant.expireDatePickerOpen = true;
                }
                checkForBackdropClick();
                $scope.model.disableSubmitButton = !canSchedule();
            }
            /**
     * Remove flag when a date picker closes so the overlay can be closed again
     * @param {any} variant 
     * @param {any} type publish or unpublish
     */
            function datePickerClose(variant, type) {
                $timeout(function () {
                    if (type === 'publish') {
                        variant.releaseDatePickerOpen = false;
                    } else if (type === 'unpublish') {
                        variant.expireDatePickerOpen = false;
                    }
                    checkForBackdropClick();
                    $scope.model.disableSubmitButton = !canSchedule();
                }, 200);
            }
            /**
     * Prevent the overlay from closing if any date pickers are open
     */
            function checkForBackdropClick() {
                var open = _.find(vm.variants, function (variant) {
                    return variant.releaseDatePickerOpen || variant.expireDatePickerOpen;
                });
                if (open) {
                    $scope.model.disableBackdropClick = true;
                } else {
                    $scope.model.disableBackdropClick = false;
                }
            }
            /**
     * Sets the selected publish date
     * @param {any} variant 
     * @param {any} date The selected date
     */
            function setPublishDate(variant, date) {
                if (!date) {
                    return;
                }
                //The date being passed in here is the user's local date/time that they have selected
                //we need to convert this date back to the server date on the model.
                var serverTime = dateHelper.convertToServerStringTime(moment(date), Umbraco.Sys.ServerVariables.application.serverTimeOffset);
                // update publish value
                variant.releaseDate = serverTime;
                // make sure dates are formatted to the user's locale
                formatDatesToLocal(variant);
                // make sure the unpublish date can't be before the publish date
                variant.expireDatePickerInstance.set('minDate', moment(variant.releaseDate).format('YYYY-MM-DD HH:mm'));
            }
            /**
     * Sets the selected unpublish date
     * @param {any} variant 
     * @param {any} date The selected date
     */
            function setUnpublishDate(variant, date) {
                if (!date) {
                    return;
                }
                //The date being passed in here is the user's local date/time that they have selected
                //we need to convert this date back to the server date on the model.
                var serverTime = dateHelper.convertToServerStringTime(moment(date), Umbraco.Sys.ServerVariables.application.serverTimeOffset);
                // update publish value
                variant.expireDate = serverTime;
                // make sure dates are formatted to the user's locale
                formatDatesToLocal(variant);
                // make sure the publish date can't be after the publish date
                variant.releaseDatePickerInstance.set('maxDate', moment(variant.expireDate).format('YYYY-MM-DD HH:mm'));
            }
            /**
     * Clears the publish date
     * @param {any} variant 
     */
            function clearPublishDate(variant) {
                if (variant && variant.releaseDate) {
                    variant.releaseDate = null;
                    // we don't have a publish date anymore so we can clear the min date for unpublish
                    var now = new Date();
                    var nowFormatted = moment(now).format('YYYY-MM-DD HH:mm');
                    variant.expireDatePickerInstance.set('minDate', nowFormatted);
                }
                $scope.model.disableSubmitButton = !canSchedule();
            }
            /**
     * Clears the unpublish date
     * @param {any} variant 
     */
            function clearUnpublishDate(variant) {
                if (variant && variant.expireDate) {
                    variant.expireDate = null;
                    // we don't have a unpublish date anymore so we can clear the max date for publish
                    variant.releaseDatePickerInstance.set('maxDate', null);
                }
                $scope.model.disableSubmitButton = !canSchedule();
            }
            /**
     * Formates the selected dates to fit the user culture
     * @param {any} variant 
     */
            function formatDatesToLocal(variant) {
                if (variant && variant.releaseDate) {
                    variant.releaseDateFormatted = dateHelper.getLocalDate(variant.releaseDate, vm.currentUser.locale, 'MMM Do YYYY, HH:mm');
                }
                if (variant && variant.expireDate) {
                    variant.expireDateFormatted = dateHelper.getLocalDate(variant.expireDate, vm.currentUser.locale, 'MMM Do YYYY, HH:mm');
                }
            }
            /**
     * Called when new variants are selected or deselected
     * @param {any} variant 
     */
            function changeSelection(variant) {
                $scope.model.disableSubmitButton = !canSchedule();
                //need to set the Save state to true if publish is true
                variant.save = variant.save;
            }
            function dirtyVariantFilter(variant) {
                //determine a variant is 'dirty' (meaning it will show up as publish-able) if it's
                // * the active one
                // * it's editor is in a $dirty state
                // * it has pending saves
                // * it is unpublished
                // * it is in NotCreated state
                return variant.active || variant.isDirty || variant.state === 'Draft' || variant.state === 'PublishedPendingChanges' || variant.state === 'NotCreated';
            }
            function pristineVariantFilter(variant) {
                return !dirtyVariantFilter(variant);
            }
            /** Returns true if publishing is possible based on if there are un-published mandatory languages */
            function canSchedule() {
                // sched is enabled if
                //  1) when mandatory langs are not published AND all mandatory langs are selected AND all mandatory langs have a release date
                //  2) OR all mandatory langs are published
                //  3) OR all mandatory langs are are scheduled for publishing
                //  4) OR there has been a persisted schedule for a variant and it has now been changed
                var selectedWithDates = [];
                for (var i = 0; i < vm.variants.length; i++) {
                    var variant = vm.variants[i];
                    //if the sched dates for this variant have been removed then we must allow the schedule button to be used to save the changes
                    var schedCleared = origDates[i].releaseDate && origDates[i].releaseDate !== variant.releaseDate || origDates[i].expireDate && origDates[i].expireDate !== variant.expireDate;
                    if (schedCleared) {
                        return true;
                    }
                    var isMandatory = variant.language && variant.language.isMandatory;
                    //if this variant will show up in the publish-able list
                    var publishable = dirtyVariantFilter(variant);
                    var published = !(variant.state === 'NotCreated' || variant.state === 'Draft');
                    var isScheduledPublished = variant.releaseDate;
                    if (isMandatory && !published && !isScheduledPublished && (!publishable || !variant.save)) {
                        //if a mandatory variant isn't published or scheduled published
                        //and it's not publishable or not selected to be published
                        //then we cannot continue
                        //TODO: Show a message when this occurs
                        return false;
                    }
                    if (variant.save && (variant.releaseDate || variant.expireDate)) {
                        selectedWithDates.push(variant.save);
                    }
                }
                return selectedWithDates.length > 0;
            }
            onInit();
            //when this dialog is closed, clean up
            $scope.$on('$destroy', function () {
                for (var i = 0; i < vm.variants.length; i++) {
                    vm.variants[i].save = false;
                    // remove properties only needed for this dialog
                    delete vm.variants[i].releaseDateFormatted;
                    delete vm.variants[i].expireDateFormatted;
                    delete vm.variants[i].datePickerConfig;
                    delete vm.variants[i].releaseDatePickerInstance;
                    delete vm.variants[i].expireDatePickerInstance;
                    delete vm.variants[i].releaseDatePickerOpen;
                    delete vm.variants[i].expireDatePickerOpen;
                }
            });
        }
        angular.module('umbraco').controller('Umbraco.Overlays.ScheduleContentController', ScheduleContentController);
    }());
    'use strict';
    (function () {
        'use strict';
        function SendToPublishController($scope, localizationService) {
            var vm = this;
            vm.loading = true;
            vm.modifiedVariantFilter = modifiedVariantFilter;
            vm.unmodifiedVariantFilter = unmodifiedVariantFilter;
            vm.changeSelection = changeSelection;
            function onInit() {
                vm.variants = $scope.model.variants;
                // set dialog title
                if (!$scope.model.title) {
                    localizationService.localize('content_sendForApproval').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                if (vm.variants.length !== 0) {
                    //now sort it so that the current one is at the top
                    vm.variants = _.sortBy(vm.variants, function (v) {
                        return v.active ? 0 : 1;
                    });
                    var active = _.find(vm.variants, function (v) {
                        return v.active;
                    });
                    if (active) {
                        //ensure that the current one is selected
                        active.save = true;
                    }
                } else {
                    //disable save button if we have nothing to save
                    $scope.model.disableSubmitButton = true;
                }
                vm.loading = false;
            }
            function changeSelection() {
                var firstSelected = _.find(vm.variants, function (v) {
                    return v.save;
                });
                $scope.model.disableSubmitButton = !firstSelected;    //disable submit button if there is none selected
            }
            function modifiedVariantFilter(variant) {
                //determine a variant is 'modified' (meaning it will show up as able to send for approval)
                // * it's editor is in a $dirty state
                // * it is in Draft state
                // * it is published with pending changes
                return variant.active || variant.isDirty || variant.state === 'Draft' || variant.state === 'PublishedPendingChanges';
            }
            function unmodifiedVariantFilter(variant) {
                //determine a variant is 'unmodified' (meaning it will NOT show up as able to send for approval)
                // * it's editor is in a $dirty state
                // * it has been published
                // * it is not created for that specific language
                return variant.state === 'Published' && !variant.isDirty && !variant.active || variant.state === 'NotCreated' && !variant.isDirty && !variant.active;
            }
            //when this dialog is closed, reset all 'save' flags
            $scope.$on('$destroy', function () {
                for (var i = 0; i < vm.variants.length; i++) {
                    vm.variants[i].save = false;
                }
            });
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Overlays.SendToPublishController', SendToPublishController);
    }());
    'use strict';
    (function () {
        'use strict';
        function UnpublishController($scope, localizationService) {
            var vm = this;
            var autoSelectedVariants = [];
            vm.changeSelection = changeSelection;
            vm.publishedVariantFilter = publishedVariantFilter;
            vm.unpublishedVariantFilter = unpublishedVariantFilter;
            function onInit() {
                vm.variants = $scope.model.variants;
                // set dialog title
                if (!$scope.model.title) {
                    localizationService.localize('content_unpublish').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                // node has variants
                if (vm.variants.length !== 1) {
                    //now sort it so that the current one is at the top
                    vm.variants = _.sortBy(vm.variants, function (v) {
                        return v.active ? 0 : 1;
                    });
                    var active = _.find(vm.variants, function (v) {
                        return v.active;
                    });
                    if (active) {
                        //ensure that the current one is selected
                        active.save = true;
                    }
                    // autoselect other variants if needed
                    changeSelection(active);
                }
            }
            function changeSelection(selectedVariant) {
                // disable submit button if nothing is selected
                var firstSelected = _.find(vm.variants, function (v) {
                    return v.save;
                });
                $scope.model.disableSubmitButton = !firstSelected;
                //disable submit button if there is none selected
                // if a mandatory variant is selected we want to selet all other variants 
                // and disable selection for the others
                if (selectedVariant.save && selectedVariant.language.isMandatory) {
                    angular.forEach(vm.variants, function (variant) {
                        if (!variant.save && publishedVariantFilter(variant)) {
                            // keep track of the variants we automaically select
                            // so we can remove the selection again
                            autoSelectedVariants.push(variant.language.culture);
                            variant.save = true;
                        }
                        variant.disabled = true;
                    });
                    // make sure the mandatory isn't disabled so we can deselect again
                    selectedVariant.disabled = false;
                }
                // if a mandatory variant is deselected we want to deselet all the variants
                // that was automatically selected so it goes back to the state before the mandatory language was selected.
                // We also want to enable all checkboxes again
                if (!selectedVariant.save && selectedVariant.language.isMandatory) {
                    angular.forEach(vm.variants, function (variant) {
                        // check if variant was auto selected, then deselect
                        if (_.contains(autoSelectedVariants, variant.language.culture)) {
                            variant.save = false;
                        }
                        ;
                        variant.disabled = false;
                    });
                    autoSelectedVariants = [];
                }
            }
            function publishedVariantFilter(variant) {
                //determine a variant is 'published' (meaning it will show up as able unpublish)
                // * it has been published
                // * it has been published with pending changes
                return variant.state === 'Published' || variant.state === 'PublishedPendingChanges';
            }
            function unpublishedVariantFilter(variant) {
                //determine a variant is 'modified' (meaning it will NOT show up as able to unpublish)
                // * it's editor is in a $dirty state
                // * it is published with pending changes
                return variant.state !== 'Published' && variant.state !== 'PublishedPendingChanges';
            }
            //when this dialog is closed, remove all unpublish and disabled flags
            $scope.$on('$destroy', function () {
                for (var i = 0; i < vm.variants.length; i++) {
                    vm.variants[i].save = false;
                    vm.variants[i].disabled = false;
                }
            });
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Overlays.UnpublishController', UnpublishController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.ContentBlueprint.CreateController
 * @function
 *
 * @description
 * The controller for creating content blueprints
 */
    function ContentBlueprintCreateController($scope, $location, contentTypeResource, navigationService, appState) {
        var vm = this;
        var node = $scope.currentNode;
        var section = appState.getSectionState('currentSection');
        vm.createBlueprint = createBlueprint;
        vm.close = close;
        function onInit() {
            vm.loading = true;
            contentTypeResource.getAll().then(function (documentTypes) {
                vm.documentTypes = documentTypes;
                vm.loading = false;
            });
        }
        function createBlueprint(documentType) {
            $location.path('/' + section + '/contentBlueprints/edit/' + node.id).search('create', 'true').search('doctype', documentType.alias);
            navigationService.hideMenu();
        }
        function close() {
            var showMenu = true;
            navigationService.hideDialog(showMenu);
        }
        onInit();
    }
    angular.module('umbraco').controller('Umbraco.Editors.ContentBlueprint.CreateController', ContentBlueprintCreateController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.ContentBlueprint.DeleteController
 * @function
 *
 * @description
 * The controller for deleting content blueprints
 */
    function ContentBlueprintDeleteController($scope, contentResource, treeService, navigationService) {
        $scope.performDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            contentResource.deleteBlueprint($scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                //TODO: Need to sync tree, etc...
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.ContentBlueprint.DeleteController', ContentBlueprintDeleteController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Content.EditController
 * @function
 * 
 * @description
 * The controller for the content editor
 */
    function ContentBlueprintEditController($scope, $routeParams, contentResource) {
        function getScaffold() {
            return contentResource.getScaffold(-1, $routeParams.doctype).then(function (scaffold) {
                return initialize(scaffold);
            });
        }
        function getBlueprintById(id) {
            return contentResource.getBlueprintById(id).then(function (blueprint) {
                return initialize(blueprint);
            });
        }
        function initialize(content) {
            if (content.apps && content.apps.length) {
                var contentApp = _.find(content.apps, function (app) {
                    return app.alias === 'umbContent';
                });
                content.apps = [contentApp];
            }
            content.allowPreview = false;
            content.allowedActions = [
                'A',
                'S',
                'C'
            ];
            return content;
        }
        $scope.contentId = $routeParams.id;
        $scope.isNew = $routeParams.id === '-1';
        $scope.saveMethod = contentResource.saveBlueprint;
        $scope.getMethod = getBlueprintById;
        $scope.getScaffoldMethod = getScaffold;
        //load the default culture selected in the main tree if any
        $scope.culture = $routeParams.cculture ? $routeParams.cculture : $routeParams.mculture;
        //Bind to $routeUpdate which will execute anytime a location changes but the route is not triggered.
        //This is so we can listen to changes on the cculture parameter since that will not cause a route change
        // and then we can pass in the updated culture to the editor
        $scope.$on('$routeUpdate', function (event, next) {
            $scope.culture = next.params.cculture ? next.params.cculture : $routeParams.mculture;
        });
    }
    angular.module('umbraco').controller('Umbraco.Editors.ContentBlueprint.EditController', ContentBlueprintEditController);
    'use strict';
    (function () {
        'use strict';
        function RedirectUrlsController($scope, redirectUrlsResource, notificationsService, localizationService, $q) {
            //...todo
            //search by url or url part
            //search by domain
            //display domain in dashboard results?
            //used to cancel any request in progress if another one needs to take it's place
            var vm = this;
            var canceler = null;
            vm.dashboard = {
                searchTerm: '',
                loading: false,
                urlTrackerDisabled: false,
                userIsAdmin: false
            };
            vm.pagination = {
                pageIndex: 0,
                pageNumber: 1,
                totalPages: 1,
                pageSize: 20
            };
            vm.goToPage = goToPage;
            vm.search = search;
            vm.removeRedirect = removeRedirect;
            vm.disableUrlTracker = disableUrlTracker;
            vm.enableUrlTracker = enableUrlTracker;
            vm.filter = filter;
            vm.checkEnabled = checkEnabled;
            function activate() {
                vm.checkEnabled().then(function () {
                    vm.search();
                });
            }
            function checkEnabled() {
                vm.dashboard.loading = true;
                return redirectUrlsResource.getEnableState().then(function (response) {
                    vm.dashboard.urlTrackerDisabled = response.enabled !== true;
                    vm.dashboard.userIsAdmin = response.userIsAdmin;
                    vm.dashboard.loading = false;
                });
            }
            function goToPage(pageNumber) {
                vm.pagination.pageIndex = pageNumber - 1;
                vm.pagination.pageNumber = pageNumber;
                vm.search();
            }
            function search() {
                vm.dashboard.loading = true;
                var searchTerm = vm.dashboard.searchTerm;
                if (searchTerm === undefined) {
                    searchTerm = '';
                }
                redirectUrlsResource.searchRedirectUrls(searchTerm, vm.pagination.pageIndex, vm.pagination.pageSize).then(function (response) {
                    vm.redirectUrls = response.searchResults;
                    // update pagination
                    vm.pagination.pageIndex = response.currentPage;
                    vm.pagination.pageNumber = response.currentPage + 1;
                    vm.pagination.totalPages = response.pageCount;
                    vm.dashboard.loading = false;
                });
            }
            function removeRedirect(redirectToDelete) {
                localizationService.localize('redirectUrls_confirmRemove', [
                    redirectToDelete.originalUrl,
                    redirectToDelete.destinationUrl
                ]).then(function (value) {
                    var toggleConfirm = confirm(value);
                    if (toggleConfirm) {
                        redirectUrlsResource.deleteRedirectUrl(redirectToDelete.redirectId).then(function () {
                            var index = vm.redirectUrls.indexOf(redirectToDelete);
                            vm.redirectUrls.splice(index, 1);
                            localizationService.localize('redirectUrls_redirectRemoved').then(function (value) {
                                notificationsService.success(value);
                            });
                            // check if new redirects needs to be loaded
                            if (vm.redirectUrls.length === 0 && vm.pagination.totalPages > 1) {
                                // if we are not on the first page - get records from the previous
                                if (vm.pagination.pageIndex > 0) {
                                    vm.pagination.pageIndex = vm.pagination.pageIndex - 1;
                                    vm.pagination.pageNumber = vm.pagination.pageNumber - 1;
                                }
                                search();
                            }
                        }, function (error) {
                            localizationService.localize('redirectUrls_redirectRemoveError').then(function (value) {
                                notificationsService.error(value);
                            });
                        });
                    }
                });
            }
            function disableUrlTracker() {
                localizationService.localize('redirectUrls_confirmDisable').then(function (value) {
                    var toggleConfirm = confirm(value);
                    if (toggleConfirm) {
                        redirectUrlsResource.toggleUrlTracker(true).then(function () {
                            activate();
                            localizationService.localize('redirectUrls_disabledConfirm').then(function (value) {
                                notificationsService.success(value);
                            });
                        }, function (error) {
                            localizationService.localize('redirectUrls_disableError').then(function (value) {
                                notificationsService.warning(value);
                            });
                        });
                    }
                });
            }
            function enableUrlTracker() {
                redirectUrlsResource.toggleUrlTracker(false).then(function () {
                    activate();
                    localizationService.localize('redirectUrls_enabledConfirm').then(function (value) {
                        notificationsService.success(value);
                    });
                }, function (error) {
                    localizationService.localize('redirectUrls_enableError').then(function (value) {
                        notificationsService.warning(value);
                    });
                });
            }
            var filterDebounced = _.debounce(function (e) {
                $scope.$apply(function () {
                    //a canceler exists, so perform the cancelation operation and reset
                    if (canceler) {
                        canceler.resolve();
                        canceler = $q.defer();
                    } else {
                        canceler = $q.defer();
                    }
                    vm.search();
                });
            }, 200);
            function filter() {
                vm.dashboard.loading = true;
                filterDebounced();
            }
            activate();
        }
        angular.module('umbraco').controller('Umbraco.Dashboard.RedirectUrlsController', RedirectUrlsController);
    }());
    'use strict';
    function startUpVideosDashboardController($scope, xmlhelper, $log, $http) {
        $scope.videos = [];
        $scope.init = function (url) {
            var proxyUrl = 'dashboard/feedproxy.aspx?url=' + url;
            $http.get(proxyUrl).then(function (data) {
                var feed = $(data.data);
                $('item', feed).each(function (i, item) {
                    var video = {};
                    video.thumbnail = $(item).find('thumbnail').attr('url');
                    video.title = $('title', item).text();
                    video.link = $('guid', item).text();
                    $scope.videos.push(video);
                });
            });
        };
    }
    angular.module('umbraco').controller('Umbraco.Dashboard.StartupVideosController', startUpVideosDashboardController);
    function startUpDynamicContentController($timeout, $scope, dashboardResource, assetsService, tourService, eventsService) {
        var vm = this;
        var evts = [];
        vm.loading = true;
        vm.showDefault = false;
        vm.startTour = startTour;
        function onInit() {
            // load tours
            tourService.getGroupedTours().then(function (groupedTours) {
                vm.tours = groupedTours;
            });
        }
        function startTour(tour) {
            tourService.startTour(tour);
        }
        // default dashboard content
        vm.defaultDashboard = {
            infoBoxes: [
                {
                    title: 'Documentation',
                    description: 'Find the answers to your Umbraco questions',
                    url: 'https://our.umbraco.com/documentation/?utm_source=core&utm_medium=dashboard&utm_content=text&utm_campaign=documentation/'
                },
                {
                    title: 'Community',
                    description: 'Find the answers or ask your Umbraco questions',
                    url: 'https://our.umbraco.com/?utm_source=core&utm_medium=dashboard&utm_content=text&utm_campaign=our_forum'
                },
                {
                    title: 'Umbraco.tv',
                    description: 'Tutorial videos (some are free, some are on subscription)',
                    url: 'https://umbraco.tv/?utm_source=core&utm_medium=dashboard&utm_content=text&utm_campaign=tutorial_videos'
                },
                {
                    title: 'Training',
                    description: 'Real-life training and official Umbraco certifications',
                    url: 'https://umbraco.com/training/?utm_source=core&utm_medium=dashboard&utm_content=text&utm_campaign=training'
                }
            ],
            articles: [
                {
                    title: 'Umbraco.TV - Learn from the source!',
                    description: 'Umbraco.TV will help you go from zero to Umbraco hero at a pace that suits you. Our easy to follow online training videos will give you the fundamental knowledge to start building awesome Umbraco websites.',
                    img: 'views/dashboard/default/umbracotv.jpg',
                    url: 'https://umbraco.tv/?utm_source=core&utm_medium=dashboard&utm_content=image&utm_campaign=tv',
                    altText: 'Umbraco.TV - Hours of Umbraco Video Tutorials',
                    buttonText: 'Visit Umbraco.TV'
                },
                {
                    title: 'Our Umbraco - The Friendliest Community',
                    description: 'Our Umbraco - the official community site is your one stop for everything Umbraco. Whether you need a question answered or looking for cool plugins, the world\'s best and friendliest community is just a click away.',
                    img: 'views/dashboard/default/ourumbraco.jpg',
                    url: 'https://our.umbraco.com/?utm_source=core&utm_medium=dashboard&utm_content=image&utm_campaign=our',
                    altText: 'Our Umbraco',
                    buttonText: 'Visit Our Umbraco'
                }
            ]
        };
        evts.push(eventsService.on('appState.tour.complete', function (name, completedTour) {
            $timeout(function () {
                angular.forEach(vm.tours, function (tourGroup) {
                    angular.forEach(tourGroup, function (tour) {
                        if (tour.alias === completedTour.alias) {
                            tour.completed = true;
                        }
                    });
                });
            });
        }));
        //proxy remote css through the local server
        assetsService.loadCss(dashboardResource.getRemoteDashboardCssUrl('content'), $scope);
        dashboardResource.getRemoteDashboardContent('content').then(function (data) {
            vm.loading = false;
            //test if we have received valid data
            //we capture it like this, so we avoid UI errors - which automatically triggers ui based on http response code
            if (data && data.sections) {
                vm.dashboard = data;
            } else {
                vm.showDefault = true;
            }
        }, function (exception) {
            console.error(exception);
            vm.loading = false;
            vm.showDefault = true;
        });
        onInit();
    }
    angular.module('umbraco').controller('Umbraco.Dashboard.StartUpDynamicContentController', startUpDynamicContentController);
    function FormsController($scope, $route, $cookies, packageResource, localizationService) {
        var labels = {};
        var labelKeys = [
            'packager_installStateDownloading',
            'packager_installStateImporting',
            'packager_installStateInstalling',
            'packager_installStateRestarting',
            'packager_installStateComplete'
        ];
        localizationService.localizeMany(labelKeys).then(function (values) {
            labels.installStateDownloading = values[0];
            labels.installStateImporting = values[1];
            labels.installStateInstalling = values[2];
            labels.installStateRestarting = values[3];
            labels.installStateComplete = values[4];
        });
        $scope.installForms = function () {
            $scope.state = labels.installStateDownloading;
            packageResource.fetch('CD44CF39-3D71-4C19-B6EE-948E1FAF0525').then(function (pack) {
                $scope.state = labels.installStateImporting;
                return packageResource.import(pack);
            }, $scope.error).then(function (pack) {
                $scope.state = labels.installStateInstalling;
                return packageResource.installFiles(pack);
            }, $scope.error).then(function (pack) {
                $scope.state = labels.installStateRestarting;
                return packageResource.installData(pack);
            }, $scope.error).then(function (pack) {
                $scope.state = installStateComplete;
                return packageResource.cleanUp(pack);
            }, $scope.error).then($scope.complete, $scope.error);
        };
        $scope.complete = function (result) {
            var url = window.location.href + '?init=true';
            $cookies.putObject('umbPackageInstallId', result.packageGuid);
            window.location.reload(true);
        };
        $scope.error = function (err) {
            $scope.state = undefined;
            $scope.error = err;
            //This will return a rejection meaning that the promise change above will stop
            return $q.reject();
        };
        function Video_player(videoId) {
            // Get dom elements
            this.container = document.getElementById(videoId);
            this.video = this.container.getElementsByTagName('video')[0];
            //Create controls
            this.controls = document.createElement('div');
            this.controls.className = 'video-controls';
            this.seek_bar = document.createElement('input');
            this.seek_bar.className = 'seek-bar';
            this.seek_bar.type = 'range';
            this.seek_bar.setAttribute('value', '0');
            this.loader = document.createElement('div');
            this.loader.className = 'loader';
            this.progress_bar = document.createElement('span');
            this.progress_bar.className = 'progress-bar';
            // Insert controls
            this.controls.appendChild(this.seek_bar);
            this.container.appendChild(this.controls);
            this.controls.appendChild(this.loader);
            this.loader.appendChild(this.progress_bar);
        }
        Video_player.prototype.seeking = function () {
            // get the value of the seekbar (hidden input[type="range"])
            var time = this.video.duration * (this.seek_bar.value / 100);
            // Update video to seekbar value
            this.video.currentTime = time;
        };
        // Stop video when user initiates seeking
        Video_player.prototype.start_seek = function () {
            this.video.pause();
        };
        // Start video when user stops seeking
        Video_player.prototype.stop_seek = function () {
            this.video.play();
        };
        // Update the progressbar (span.loader) according to video.currentTime
        Video_player.prototype.update_progress_bar = function () {
            // Get video progress in %
            var value = 100 / this.video.duration * this.video.currentTime;
            // Update progressbar
            this.progress_bar.style.width = value + '%';
        };
        // Bind progressbar to mouse when seeking
        Video_player.prototype.handle_mouse_move = function (event) {
            // Get position of progressbar relative to browser window
            var pos = this.progress_bar.getBoundingClientRect().left;
            // Make sure event is reckonized cross-browser
            event = event || window.event;
            // Update progressbar
            this.progress_bar.style.width = event.clientX - pos + 'px';
        };
        // Eventlisteners for seeking
        Video_player.prototype.video_event_handler = function (videoPlayer, interval) {
            // Update the progress bar
            var animate_progress_bar = setInterval(function () {
                videoPlayer.update_progress_bar();
            }, interval);
            // Fire when input value changes (user seeking)
            videoPlayer.seek_bar.addEventListener('change', function () {
                videoPlayer.seeking();
            });
            // Fire when user clicks on seekbar
            videoPlayer.seek_bar.addEventListener('mousedown', function (clickEvent) {
                // Pause video playback
                videoPlayer.start_seek();
                // Stop updating progressbar according to video progress
                clearInterval(animate_progress_bar);
                // Update progressbar to where user clicks
                videoPlayer.handle_mouse_move(clickEvent);
                // Bind progressbar to cursor
                window.onmousemove = function (moveEvent) {
                    videoPlayer.handle_mouse_move(moveEvent);
                };
            });
            // Fire when user releases seekbar
            videoPlayer.seek_bar.addEventListener('mouseup', function () {
                // Unbind progressbar from cursor
                window.onmousemove = null;
                // Start video playback
                videoPlayer.stop_seek();
                // Animate the progressbar
                animate_progress_bar = setInterval(function () {
                    videoPlayer.update_progress_bar();
                }, interval);
            });
        };
        var videoPlayer = new Video_player('video_1');
        videoPlayer.video_event_handler(videoPlayer, 17);
    }
    angular.module('umbraco').controller('Umbraco.Dashboard.FormsDashboardController', FormsController);
    function startupLatestEditsController($scope) {
    }
    angular.module('umbraco').controller('Umbraco.Dashboard.StartupLatestEditsController', startupLatestEditsController);
    function MediaFolderBrowserDashboardController($rootScope, $scope, $location, contentTypeResource, userService) {
        var currentUser = {};
        userService.getCurrentUser().then(function (user) {
            currentUser = user;
            // check if the user has access to the root which they will require to see this dashboard
            if (currentUser.startMediaIds.indexOf(-1) >= 0) {
                //get the system media listview
                contentTypeResource.getPropertyTypeScaffold(-96).then(function (dt) {
                    $scope.fakeProperty = {
                        alias: 'contents',
                        config: dt.config,
                        description: '',
                        editor: dt.editor,
                        hideLabel: true,
                        id: 1,
                        label: 'Contents:',
                        validation: {
                            mandatory: false,
                            pattern: null
                        },
                        value: '',
                        view: dt.view
                    };
                });
            } else if (currentUser.startMediaIds.length > 0) {
                // redirect to start node
                $location.path('/media/media/edit/' + (currentUser.startMediaIds.length === 0 ? -1 : currentUser.startMediaIds[0]));
            }
        });
    }
    angular.module('umbraco').controller('Umbraco.Dashboard.MediaFolderBrowserDashboardController', MediaFolderBrowserDashboardController);
    'use strict';
    function ExamineManagementController($scope, umbRequestHelper, $http, $q, $timeout) {
        var vm = this;
        vm.indexerDetails = [];
        vm.searcherDetails = [];
        vm.loading = true;
        vm.viewState = 'list';
        vm.selectedIndex = null;
        vm.selectedSearcher = null;
        vm.searchResults = null;
        vm.showSearchResultDialog = showSearchResultDialog;
        vm.showIndexInfo = showIndexInfo;
        vm.showSearcherInfo = showSearcherInfo;
        vm.search = search;
        vm.toggle = toggle;
        vm.rebuildIndex = rebuildIndex;
        vm.setViewState = setViewState;
        vm.nextSearchResultPage = nextSearchResultPage;
        vm.prevSearchResultPage = prevSearchResultPage;
        vm.goToPageSearchResultPage = goToPageSearchResultPage;
        vm.infoOverlay = null;
        function showSearchResultDialog(values) {
            if (vm.searchResults) {
                vm.searchResults.overlay = {
                    title: 'Field values',
                    searchResultValues: values,
                    view: 'views/dashboard/settings/examinemanagementresults.html',
                    close: function close() {
                        vm.searchResults.overlay = null;
                    }
                };
            }
        }
        function nextSearchResultPage(pageNumber) {
            search(vm.selectedIndex ? vm.selectedIndex : vm.selectedSearcher, null, pageNumber);
        }
        function prevSearchResultPage(pageNumber) {
            search(vm.selectedIndex ? vm.selectedIndex : vm.selectedSearcher, null, pageNumber);
        }
        function goToPageSearchResultPage(pageNumber) {
            search(vm.selectedIndex ? vm.selectedIndex : vm.selectedSearcher, null, pageNumber);
        }
        function setViewState(state) {
            vm.searchResults = null;
            vm.viewState = state;
        }
        function showIndexInfo(index) {
            vm.selectedIndex = index;
            setViewState('index-details');
        }
        function showSearcherInfo(searcher) {
            vm.selectedSearcher = searcher;
            setViewState('searcher-details');
        }
        function checkProcessing(index, checkActionName) {
            umbRequestHelper.resourcePromise($http.post(umbRequestHelper.getApiUrl('examineMgmtBaseUrl', checkActionName, { indexName: index.name })), 'Failed to check index processing').then(function (data) {
                if (data !== null && data !== 'null') {
                    //copy all resulting properties
                    for (var k in data) {
                        index[k] = data[k];
                    }
                    index.isProcessing = false;
                } else {
                    $timeout(function () {
                        //don't continue if we've tried 100 times
                        if (index.processingAttempts < 100) {
                            checkProcessing(index, checkActionName);
                            //add an attempt
                            index.processingAttempts++;
                        } else {
                            //we've exceeded 100 attempts, stop processing
                            index.isProcessing = false;
                        }
                    }, 1000);
                }
            });
        }
        function search(searcher, e, pageNumber) {
            //deal with accepting pressing the enter key
            if (e && e.keyCode !== 13) {
                return;
            }
            if (!searcher) {
                throw 'searcher parameter is required';
            }
            searcher.isProcessing = true;
            umbRequestHelper.resourcePromise($http.get(umbRequestHelper.getApiUrl('examineMgmtBaseUrl', 'GetSearchResults', {
                searcherName: searcher.name,
                query: encodeURIComponent(vm.searchText),
                pageIndex: pageNumber ? pageNumber - 1 : 0
            })), 'Failed to search').then(function (searchResults) {
                searcher.isProcessing = false;
                vm.searchResults = searchResults;
                vm.searchResults.pageNumber = pageNumber ? pageNumber : 1;
                //20 is page size
                vm.searchResults.totalPages = Math.ceil(vm.searchResults.totalRecords / 20);
            });
        }
        function toggle(provider, propName) {
            if (provider[propName] !== undefined) {
                provider[propName] = !provider[propName];
            } else {
                provider[propName] = true;
            }
        }
        function rebuildIndex(index) {
            if (confirm('This will cause the index to be rebuilt. ' + 'Depending on how much content there is in your site this could take a while. ' + 'It is not recommended to rebuild an index during times of high website traffic ' + 'or when editors are editing content.')) {
                index.isProcessing = true;
                index.processingAttempts = 0;
                umbRequestHelper.resourcePromise($http.post(umbRequestHelper.getApiUrl('examineMgmtBaseUrl', 'PostRebuildIndex', { indexName: index.name })), 'Failed to rebuild index').then(function () {
                    //rebuilding has started, nothing is returned accept a 200 status code.
                    //lets poll to see if it is done.
                    $timeout(function () {
                        checkProcessing(index, 'PostCheckRebuildIndex'), 1000;
                    });
                });
            }
        }
        function init() {
            //go get the data
            //combine two promises and execute when they are both done
            $q.all([
                //get the indexer details
                umbRequestHelper.resourcePromise($http.get(umbRequestHelper.getApiUrl('examineMgmtBaseUrl', 'GetIndexerDetails')), 'Failed to retrieve indexer details').then(function (data) {
                    vm.indexerDetails = data;
                }),
                //get the searcher details
                umbRequestHelper.resourcePromise($http.get(umbRequestHelper.getApiUrl('examineMgmtBaseUrl', 'GetSearcherDetails')), 'Failed to retrieve searcher details').then(function (data) {
                    vm.searcherDetails = data;
                })
            ]).then(function () {
                vm.loading = false;
            });
        }
        init();
    }
    angular.module('umbraco').controller('Umbraco.Dashboard.ExamineManagementController', ExamineManagementController);
    'use strict';
    (function () {
        'use strict';
        function HealthCheckController($scope, healthCheckResource) {
            var SUCCESS = 0;
            var WARNING = 1;
            var ERROR = 2;
            var INFO = 3;
            var vm = this;
            vm.viewState = 'list';
            vm.groups = [];
            vm.selectedGroup = {};
            vm.getStatus = getStatus;
            vm.executeAction = executeAction;
            vm.checkAllGroups = checkAllGroups;
            vm.checkAllInGroup = checkAllInGroup;
            vm.openGroup = openGroup;
            vm.setViewState = setViewState;
            // Get a (grouped) list of all health checks
            healthCheckResource.getAllChecks().then(function (response) {
                vm.groups = response;
            });
            function setGroupGlobalResultType(group) {
                var totalSuccess = 0;
                var totalError = 0;
                var totalWarning = 0;
                var totalInfo = 0;
                // count total number of statusses
                angular.forEach(group.checks, function (check) {
                    angular.forEach(check.status, function (status) {
                        switch (status.resultType) {
                        case SUCCESS:
                            totalSuccess = totalSuccess + 1;
                            break;
                        case WARNING:
                            totalWarning = totalWarning + 1;
                            break;
                        case ERROR:
                            totalError = totalError + 1;
                            break;
                        case INFO:
                            totalInfo = totalInfo + 1;
                            break;
                        }
                    });
                });
                group.totalSuccess = totalSuccess;
                group.totalError = totalError;
                group.totalWarning = totalWarning;
                group.totalInfo = totalInfo;
            }
            // Get the status of an individual check
            function getStatus(check) {
                check.loading = true;
                check.status = null;
                healthCheckResource.getStatus(check.id).then(function (response) {
                    check.loading = false;
                    check.status = response;
                });
            }
            function executeAction(check, index, action) {
                check.loading = true;
                healthCheckResource.executeAction(action).then(function (response) {
                    check.status[index] = response;
                    check.loading = false;
                });
            }
            function checkAllGroups(groups) {
                // set number of checks which has been executed
                for (var i = 0; i < groups.length; i++) {
                    var group = groups[i];
                    checkAllInGroup(group, group.checks);
                }
                vm.groups = groups;
            }
            function checkAllInGroup(group, checks) {
                group.checkCounter = 0;
                group.loading = true;
                angular.forEach(checks, function (check) {
                    check.loading = true;
                    healthCheckResource.getStatus(check.id).then(function (response) {
                        check.status = response;
                        group.checkCounter = group.checkCounter + 1;
                        check.loading = false;
                        // when all checks are done, set global group result
                        if (group.checkCounter === checks.length) {
                            setGroupGlobalResultType(group);
                            group.loading = false;
                        }
                    });
                });
            }
            function openGroup(group) {
                vm.selectedGroup = group;
                vm.viewState = 'details';
            }
            function setViewState(state) {
                vm.viewState = state;
                if (state === 'list') {
                    for (var i = 0; i < vm.groups.length; i++) {
                        var group = vm.groups[i];
                        setGroupGlobalResultType(group);
                    }
                }
            }
        }
        angular.module('umbraco').controller('Umbraco.Dashboard.HealthCheckController', HealthCheckController);
    }());
    'use strict';
    function nuCacheController($scope, umbRequestHelper, $log, $http, $q, $timeout) {
        $scope.reload = function () {
            if ($scope.working)
                return;
            if (confirm('Trigger a in-memory and local file cache reload on all servers.')) {
                $scope.working = true;
                umbRequestHelper.resourcePromise($http.post(umbRequestHelper.getApiUrl('nuCacheStatusBaseUrl', 'ReloadCache')), 'Failed to trigger a cache reload').then(function (result) {
                    $scope.working = false;
                });
            }
        };
        $scope.collect = function () {
            if ($scope.working)
                return;
            $scope.working = true;
            umbRequestHelper.resourcePromise($http.get(umbRequestHelper.getApiUrl('nuCacheStatusBaseUrl', 'Collect')), 'Failed to verify the cache.').then(function (result) {
                $scope.working = false;
                $scope.status = result;
            });
        };
        $scope.verify = function () {
            if ($scope.working)
                return;
            $scope.working = true;
            umbRequestHelper.resourcePromise($http.get(umbRequestHelper.getApiUrl('nuCacheStatusBaseUrl', 'GetStatus')), 'Failed to verify the cache.').then(function (result) {
                $scope.working = false;
                $scope.status = result;
            });
        };
        $scope.rebuild = function () {
            if ($scope.working)
                return;
            if (confirm('Rebuild cmsContentNu table content. Expensive.')) {
                $scope.working = true;
                umbRequestHelper.resourcePromise($http.post(umbRequestHelper.getApiUrl('nuCacheStatusBaseUrl', 'RebuildDbCache')), 'Failed to rebuild the cache.').then(function (result) {
                    $scope.working = false;
                    $scope.status = result;
                });
            }
        };
        $scope.working = false;
        $scope.verify();
    }
    angular.module('umbraco').controller('Umbraco.Dashboard.NuCacheController', nuCacheController);
    'use strict';
    function publishedStatusController($scope, umbRequestHelper, $log, $http, $q, $timeout) {
        // note: must defined base url in BackOfficeController
        umbRequestHelper.resourcePromise($http.get(umbRequestHelper.getApiUrl('publishedStatusBaseUrl', 'GetPublishedStatusUrl')), 'Failed to get published status url').then(function (result) {
            //result = 'views/dashboard/developer/nucache.html'
            $scope.includeUrl = result;
        });
    }
    angular.module('umbraco').controller('Umbraco.Dashboard.PublishedStatusController', publishedStatusController);
    'use strict';
    function XmlDataIntegrityReportController($scope, umbRequestHelper, $log, $http) {
        function check(item) {
            var action = item.check;
            umbRequestHelper.resourcePromise($http.get(umbRequestHelper.getApiUrl('xmlDataIntegrityBaseUrl', action)), 'Failed to retrieve data integrity status').then(function (result) {
                item.checking = false;
                item.invalid = result === 'false';
            });
        }
        $scope.fix = function (item) {
            var action = item.fix;
            if (item.fix) {
                if (confirm('This will cause all xml structures for this type to be rebuilt. ' + 'Depending on how much content there is in your site this could take a while. ' + 'It is not recommended to rebuild xml structures if they are not out of sync, during times of high website traffic ' + 'or when editors are editing content.')) {
                    item.fixing = true;
                    umbRequestHelper.resourcePromise($http.post(umbRequestHelper.getApiUrl('xmlDataIntegrityBaseUrl', action)), 'Failed to retrieve data integrity status').then(function (result) {
                        item.fixing = false;
                        item.invalid = result === 'false';
                    });
                }
            }
        };
        $scope.items = {
            'contentXml': {
                label: 'Content in the cmsContentXml table',
                checking: true,
                fixing: false,
                fix: 'FixContentXmlTable',
                check: 'CheckContentXmlTable'
            },
            'mediaXml': {
                label: 'Media in the cmsContentXml table',
                checking: true,
                fixing: false,
                fix: 'FixMediaXmlTable',
                check: 'CheckMediaXmlTable'
            },
            'memberXml': {
                label: 'Members in the cmsContentXml table',
                checking: true,
                fixing: false,
                fix: 'FixMembersXmlTable',
                check: 'CheckMembersXmlTable'
            }
        };
        for (var i in $scope.items) {
            check($scope.items[i]);
        }
    }
    angular.module('umbraco').controller('Umbraco.Dashboard.XmlDataIntegrityReportController', XmlDataIntegrityReportController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.DataType.CreateController
 * @function
 *
 * @description
 * The controller for the data type creation dialog
 */
    function DataTypeCreateController($scope, $location, navigationService, dataTypeResource, formHelper, appState) {
        $scope.model = {
            folderName: '',
            creatingFolder: false
        };
        var node = $scope.currentNode;
        var section = appState.getSectionState('currentSection');
        $scope.showCreateFolder = function () {
            $scope.model.creatingFolder = true;
        };
        $scope.createContainer = function () {
            if (formHelper.submitForm({
                    scope: $scope,
                    formCtrl: this.createFolderForm
                })) {
                dataTypeResource.createContainer(node.id, $scope.model.folderName).then(function (folderId) {
                    navigationService.hideMenu();
                    var currPath = node.path ? node.path : '-1';
                    navigationService.syncTree({
                        tree: 'datatypes',
                        path: currPath + ',' + folderId,
                        forceReload: true,
                        activate: true
                    });
                    formHelper.resetForm({ scope: $scope });
                }, function (err) {
                });
            }
            ;
        };
        $scope.createDataType = function () {
            $location.search('create', null);
            $location.path('/' + section + '/datatypes/edit/' + node.id).search('create', 'true');
            navigationService.hideMenu();
        };
        $scope.close = function () {
            var showMenu = true;
            navigationService.hideDialog(showMenu);
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.DataType.CreateController', DataTypeCreateController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.ContentDeleteController
 * @function
 * 
 * @description
 * The controller for deleting content
 */
    function DataTypeDeleteController($scope, dataTypeResource, treeService, navigationService) {
        $scope.performDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            dataTypeResource.deleteById($scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                //TODO: Need to sync tree, etc...
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
            });
        };
        $scope.performContainerDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            dataTypeResource.deleteContainerById($scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                //TODO: Need to sync tree, etc...
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.DataType.DeleteController', DataTypeDeleteController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.DataType.EditController
 * @function
 *
 * @description
 * The controller for the content editor
 */
    function DataTypeEditController($scope, $routeParams, appState, navigationService, dataTypeResource, serverValidationManager, contentEditingHelper, formHelper, editorState, dataTypeHelper, eventsService) {
        //setup scope vars
        $scope.page = {};
        $scope.page.loading = false;
        $scope.page.nameLocked = false;
        $scope.page.menu = {};
        $scope.page.menu.currentSection = appState.getSectionState('currentSection');
        $scope.page.menu.currentNode = null;
        var evts = [];
        //method used to configure the pre-values when we retrieve them from the server
        function createPreValueProps(preVals) {
            $scope.preValues = [];
            for (var i = 0; i < preVals.length; i++) {
                $scope.preValues.push({
                    hideLabel: preVals[i].hideLabel,
                    alias: preVals[i].key,
                    description: preVals[i].description,
                    label: preVals[i].label,
                    view: preVals[i].view,
                    value: preVals[i].value,
                    config: preVals[i].config
                });
            }
        }
        //set up the standard data type props
        $scope.properties = {
            selectedEditor: {
                alias: 'selectedEditor',
                description: 'Select a property editor',
                label: 'Property editor'
            },
            selectedEditorId: {
                alias: 'selectedEditorId',
                label: 'Property editor alias'
            }
        };
        //setup the pre-values as props
        $scope.preValues = [];
        if ($routeParams.create) {
            $scope.page.loading = true;
            $scope.showIdentifier = false;
            //we are creating so get an empty data type item
            dataTypeResource.getScaffold($routeParams.id).then(function (data) {
                $scope.preValuesLoaded = true;
                $scope.content = data;
                setHeaderNameState($scope.content);
                //set a shared state
                editorState.set($scope.content);
                $scope.page.loading = false;
            });
        } else {
            loadDataType();
        }
        function loadDataType() {
            $scope.page.loading = true;
            $scope.showIdentifier = true;
            //we are editing so get the content item from the server
            dataTypeResource.getById($routeParams.id).then(function (data) {
                $scope.preValuesLoaded = true;
                $scope.content = data;
                createPreValueProps($scope.content.preValues);
                setHeaderNameState($scope.content);
                //share state
                editorState.set($scope.content);
                //in one particular special case, after we've created a new item we redirect back to the edit
                // route but there might be server validation errors in the collection which we need to display
                // after the redirect, so we will bind all subscriptions which will show the server validation errors
                // if there are any and then clear them so the collection no longer persists them.
                serverValidationManager.notifyAndClearAllSubscriptions();
                navigationService.syncTree({
                    tree: 'datatypes',
                    path: data.path
                }).then(function (syncArgs) {
                    $scope.page.menu.currentNode = syncArgs.node;
                });
                $scope.page.loading = false;
            });
        }
        $scope.$watch('content.selectedEditor', function (newVal, oldVal) {
            //when the value changes, we need to dynamically load in the new editor
            if (newVal && newVal != oldVal && (oldVal || $routeParams.create)) {
                //we are editing so get the content item from the server
                var currDataTypeId = $routeParams.create ? undefined : $routeParams.id;
                dataTypeResource.getPreValues(newVal, currDataTypeId).then(function (data) {
                    $scope.preValuesLoaded = true;
                    $scope.content.preValues = data;
                    createPreValueProps($scope.content.preValues);
                    setHeaderNameState($scope.content);
                    //share state
                    editorState.set($scope.content);
                });
            }
        });
        function setHeaderNameState(content) {
            if (content.isSystem == 1) {
                $scope.page.nameLocked = true;
            }
        }
        $scope.save = function () {
            if (formHelper.submitForm({ scope: $scope })) {
                $scope.page.saveButtonState = 'busy';
                dataTypeResource.save($scope.content, $scope.preValues, $routeParams.create).then(function (data) {
                    formHelper.resetForm({ scope: $scope });
                    contentEditingHelper.handleSuccessfulSave({
                        scope: $scope,
                        savedContent: data,
                        rebindCallback: function rebindCallback() {
                            createPreValueProps(data.preValues);
                        }
                    });
                    setHeaderNameState($scope.content);
                    //share state
                    editorState.set($scope.content);
                    navigationService.syncTree({
                        tree: 'datatypes',
                        path: data.path,
                        forceReload: true
                    }).then(function (syncArgs) {
                        $scope.page.menu.currentNode = syncArgs.node;
                    });
                    $scope.page.saveButtonState = 'success';
                    dataTypeHelper.rebindChangedProperties($scope.content, data);
                }, function (err) {
                    //NOTE: in the case of data type values we are setting the orig/new props
                    // to be the same thing since that only really matters for content/media.
                    contentEditingHelper.handleSaveError({
                        redirectOnFailure: false,
                        err: err
                    });
                    $scope.page.saveButtonState = 'error';
                    //share state
                    editorState.set($scope.content);
                });
            }
        };
        evts.push(eventsService.on('app.refreshEditor', function (name, error) {
            loadDataType();
        }));
        //ensure to unregister from all events!
        $scope.$on('$destroy', function () {
            for (var e in evts) {
                eventsService.unsubscribe(evts[e]);
            }
        });
    }
    angular.module('umbraco').controller('Umbraco.Editors.DataType.EditController', DataTypeEditController);
    'use strict';
    angular.module('umbraco').controller('Umbraco.Editors.DataType.MoveController', function ($scope, dataTypeResource, treeService, navigationService, notificationsService, appState, eventsService) {
        $scope.dialogTreeApi = {};
        $scope.source = _.clone($scope.currentNode);
        function nodeSelectHandler(args) {
            args.event.preventDefault();
            args.event.stopPropagation();
            if ($scope.target) {
                //un-select if there's a current one selected
                $scope.target.selected = false;
            }
            $scope.target = args.node;
            $scope.target.selected = true;
        }
        $scope.move = function () {
            $scope.busy = true;
            $scope.error = false;
            dataTypeResource.move({
                parentId: $scope.target.id,
                id: $scope.source.id
            }).then(function (path) {
                $scope.error = false;
                $scope.success = true;
                $scope.busy = false;
                //first we need to remove the node that launched the dialog
                treeService.removeNode($scope.currentNode);
                //get the currently edited node (if any)
                var activeNode = appState.getTreeState('selectedNode');
                //we need to do a double sync here: first sync to the moved content - but don't activate the node,
                //then sync to the currenlty edited content (note: this might not be the content that was moved!!)
                navigationService.syncTree({
                    tree: 'dataTypes',
                    path: path,
                    forceReload: true,
                    activate: false
                }).then(function (args) {
                    if (activeNode) {
                        var activeNodePath = treeService.getPath(activeNode).join();
                        //sync to this node now - depending on what was copied this might already be synced but might not be
                        navigationService.syncTree({
                            tree: 'dataTypes',
                            path: activeNodePath,
                            forceReload: false,
                            activate: true
                        });
                    }
                });
                eventsService.emit('app.refreshEditor');
            }, function (err) {
                $scope.success = false;
                $scope.error = err;
                $scope.busy = false;
            });
        };
        $scope.onTreeInit = function () {
            $scope.dialogTreeApi.callbacks.treeNodeSelect(nodeSelectHandler);
        };
        $scope.close = function () {
            navigationService.hideDialog();
        };
    });
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Dictionary.CreateController
 * @function
 * 
 * @description
 * The controller for creating dictionary items
 */
    function DictionaryCreateController($scope, $location, dictionaryResource, navigationService, notificationsService, formHelper, appState) {
        var vm = this;
        vm.itemKey = '';
        function createItem() {
            var node = $scope.currentNode;
            dictionaryResource.create(node.id, vm.itemKey).then(function (data) {
                navigationService.hideMenu();
                // set new item as active in tree
                var currPath = node.path ? node.path : '-1';
                navigationService.syncTree({
                    tree: 'dictionary',
                    path: currPath + ',' + data,
                    forceReload: true,
                    activate: true
                });
                // reset form state
                formHelper.resetForm({ scope: $scope });
                // navigate to edit view
                var currentSection = appState.getSectionState('currentSection');
                $location.path('/' + currentSection + '/dictionary/edit/' + data);
            }, function (err) {
                if (err.data && err.data.message) {
                    notificationsService.error(err.data.message);
                    navigationService.hideMenu();
                }
            });
        }
        vm.createItem = createItem;
    }
    angular.module('umbraco').controller('Umbraco.Editors.Dictionary.CreateController', DictionaryCreateController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Dictionary.DeleteController
 * @function
 * 
 * @description
 * The controller for deleting dictionary items
 */
    function DictionaryDeleteController($scope, $location, dictionaryResource, treeService, navigationService, appState) {
        var vm = this;
        function cancel() {
            navigationService.hideDialog();
        }
        function performDelete() {
            // stop from firing again on double-click
            if ($scope.busy) {
                return false;
            }
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            $scope.busy = true;
            dictionaryResource.deleteById($scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                // get the parent id 
                var parentId = $scope.currentNode.parentId;
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
                var currentSection = appState.getSectionState('currentSection');
                if (parentId !== '-1') {
                    // set the view of the parent item
                    $location.path('/' + currentSection + '/dictionary/edit/' + parentId);
                } else {
                    // we have no parent, so redirect to section
                    $location.path('/' + currentSection + '/');
                }
            });
        }
        vm.cancel = cancel;
        vm.performDelete = performDelete;
    }
    angular.module('umbraco').controller('Umbraco.Editors.Dictionary.DeleteController', DictionaryDeleteController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Dictionary.EditController
 * @function
 * 
 * @description
 * The controller for editing dictionary items
 */
    function DictionaryEditController($scope, $routeParams, $location, dictionaryResource, navigationService, appState, editorState, contentEditingHelper, formHelper, notificationsService, localizationService) {
        var vm = this;
        //setup scope vars
        vm.nameDirty = false;
        vm.page = {};
        vm.page.loading = false;
        vm.page.nameLocked = false;
        vm.page.menu = {};
        vm.page.menu.currentSection = appState.getSectionState('currentSection');
        vm.page.menu.currentNode = null;
        vm.description = '';
        vm.showBackButton = true;
        vm.save = saveDictionary;
        vm.back = back;
        function loadDictionary() {
            vm.page.loading = true;
            //we are editing so get the content item from the server
            dictionaryResource.getById($routeParams.id).then(function (data) {
                bindDictionary(data);
                vm.page.loading = false;
            });
        }
        function createTranslationProperty(translation) {
            return {
                alias: translation.isoCode,
                label: translation.displayName,
                hideLabel: false
            };
        }
        function bindDictionary(data) {
            localizationService.localize('dictionaryItem_description').then(function (value) {
                vm.description = value.replace('%0%', data.name);
            });
            // create data for  umb-property displaying
            for (var i = 0; i < data.translations.length; i++) {
                data.translations[i].property = createTranslationProperty(data.translations[i]);
            }
            contentEditingHelper.handleSuccessfulSave({
                scope: $scope,
                savedContent: data
            });
            // set content
            vm.content = data;
            //share state
            editorState.set(vm.content);
            navigationService.syncTree({
                tree: 'dictionary',
                path: data.path,
                forceReload: true
            }).then(function (syncArgs) {
                vm.page.menu.currentNode = syncArgs.node;
            });
        }
        function onInit() {
            loadDictionary();
        }
        function saveDictionary() {
            if (formHelper.submitForm({
                    scope: $scope,
                    statusMessage: 'Saving...'
                })) {
                vm.page.saveButtonState = 'busy';
                dictionaryResource.save(vm.content, vm.nameDirty).then(function (data) {
                    formHelper.resetForm({
                        scope: $scope,
                        notifications: data.notifications
                    });
                    bindDictionary(data);
                    vm.page.saveButtonState = 'success';
                }, function (err) {
                    contentEditingHelper.handleSaveError({
                        redirectOnFailure: false,
                        err: err
                    });
                    notificationsService.error(err.data.message);
                    vm.page.saveButtonState = 'error';
                });
            }
        }
        function back() {
            $location.path(vm.page.menu.currentSection + '/dictionary/list');
        }
        $scope.$watch('vm.content.name', function (newVal, oldVal) {
            //when the value changes, we need to set the name dirty
            if (newVal && newVal !== oldVal && typeof oldVal !== 'undefined') {
                vm.nameDirty = true;
            }
        });
        onInit();
    }
    angular.module('umbraco').controller('Umbraco.Editors.Dictionary.EditController', DictionaryEditController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Dictionary.ListController
 * @function
 * 
 * @description
 * The controller for listting dictionary items
 */
    function DictionaryListController($scope, $location, dictionaryResource, localizationService, appState) {
        var vm = this;
        vm.title = 'Dictionary overview';
        vm.loading = false;
        vm.items = [];
        function loadList() {
            vm.loading = true;
            dictionaryResource.getList().then(function (data) {
                vm.items = data;
                angular.forEach(vm.items, function (item) {
                    item.style = { 'paddingLeft': item.level * 10 };
                });
                vm.loading = false;
            });
        }
        function clickItem(id) {
            var currentSection = appState.getSectionState('currentSection');
            $location.path('/' + currentSection + '/dictionary/edit/' + id);
        }
        vm.clickItem = clickItem;
        function onInit() {
            localizationService.localize('dictionaryItem_overviewTitle').then(function (value) {
                vm.title = value;
            });
            loadList();
        }
        onInit();
    }
    angular.module('umbraco').controller('Umbraco.Editors.Dictionary.ListController', DictionaryListController);
    'use strict';
    angular.module('umbraco').controller('Umbraco.Editors.DocumentTypes.CopyController', function ($scope, contentTypeResource, treeService, navigationService, notificationsService, appState, eventsService) {
        $scope.dialogTreeApi = {};
        $scope.source = _.clone($scope.currentNode);
        function nodeSelectHandler(args) {
            args.event.preventDefault();
            args.event.stopPropagation();
            if ($scope.target) {
                //un-select if there's a current one selected
                $scope.target.selected = false;
            }
            $scope.target = args.node;
            $scope.target.selected = true;
        }
        $scope.copy = function () {
            $scope.busy = true;
            $scope.error = false;
            contentTypeResource.copy({
                parentId: $scope.target.id,
                id: $scope.source.id
            }).then(function (path) {
                $scope.error = false;
                $scope.success = true;
                $scope.busy = false;
                //get the currently edited node (if any)
                var activeNode = appState.getTreeState('selectedNode');
                //we need to do a double sync here: first sync to the copied content - but don't activate the node,
                //then sync to the currenlty edited content (note: this might not be the content that was copied!!)
                navigationService.syncTree({
                    tree: 'documentTypes',
                    path: path,
                    forceReload: true,
                    activate: false
                }).then(function (args) {
                    if (activeNode) {
                        var activeNodePath = treeService.getPath(activeNode).join();
                        //sync to this node now - depending on what was copied this might already be synced but might not be
                        navigationService.syncTree({
                            tree: 'documentTypes',
                            path: activeNodePath,
                            forceReload: false,
                            activate: true
                        });
                    }
                });
            }, function (err) {
                $scope.success = false;
                $scope.error = err;
                $scope.busy = false;
            });
        };
        $scope.onTreeInit = function () {
            $scope.dialogTreeApi.callbacks.treeNodeSelect(nodeSelectHandler);
        };
        $scope.close = function () {
            navigationService.hideDialog();
        };
    });
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.DocumentType.CreateController
 * @function
 *
 * @description
 * The controller for the doc type creation dialog
 */
    function DocumentTypesCreateController($scope, $location, navigationService, contentTypeResource, formHelper, appState, notificationsService, localizationService, iconHelper) {
        $scope.model = {
            allowCreateFolder: $scope.currentNode.parentId === null || $scope.currentNode.nodeType === 'container',
            folderName: '',
            creatingFolder: false,
            creatingDoctypeCollection: false
        };
        var disableTemplates = Umbraco.Sys.ServerVariables.features.disabledFeatures.disableTemplates;
        $scope.model.disableTemplates = disableTemplates;
        var node = $scope.currentNode;
        $scope.showCreateFolder = function () {
            $scope.model.creatingFolder = true;
        };
        $scope.showCreateDocTypeCollection = function () {
            $scope.model.creatingDoctypeCollection = true;
            $scope.model.collectionCreateTemplate = !$scope.model.disableTemplates;
            $scope.model.collectionItemCreateTemplate = !$scope.model.disableTemplates;
        };
        $scope.createContainer = function () {
            if (formHelper.submitForm({
                    scope: $scope,
                    formCtrl: this.createFolderForm
                })) {
                contentTypeResource.createContainer(node.id, $scope.model.folderName).then(function (folderId) {
                    navigationService.hideMenu();
                    var currPath = node.path ? node.path : '-1';
                    navigationService.syncTree({
                        tree: 'documenttypes',
                        path: currPath + ',' + folderId,
                        forceReload: true,
                        activate: true
                    });
                    formHelper.resetForm({ scope: $scope });
                    var section = appState.getSectionState('currentSection');
                }, function (err) {
                    $scope.error = err;
                });
            }
        };
        $scope.createCollection = function () {
            if (formHelper.submitForm({
                    scope: $scope,
                    formCtrl: this.createDoctypeCollectionForm,
                    statusMessage: 'Creating Doctype Collection...'
                })) {
                // see if we can find matching icons
                var collectionIcon = 'icon-folders', collectionItemIcon = 'icon-document';
                iconHelper.getIcons().then(function (icons) {
                    for (var i = 0; i < icons.length; i++) {
                        // for matching we'll require a full match for collection, partial match for item
                        if (icons[i].substring(5) == $scope.model.collectionName.toLowerCase()) {
                            collectionIcon = icons[i];
                        } else if (icons[i].substring(5).indexOf($scope.model.collectionItemName.toLowerCase()) > -1) {
                            collectionItemIcon = icons[i];
                        }
                    }
                    contentTypeResource.createCollection(node.id, $scope.model.collectionName, $scope.model.collectionCreateTemplate, $scope.model.collectionItemName, $scope.model.collectionItemCreateTemplate, collectionIcon, collectionItemIcon).then(function (collectionData) {
                        navigationService.hideMenu();
                        $location.search('create', null);
                        $location.search('notemplate', null);
                        formHelper.resetForm({ scope: $scope });
                        var section = appState.getSectionState('currentSection');
                        // redirect to the item id
                        $location.path('/' + section + '/documenttypes/edit/' + collectionData.containerId);
                    }, function (err) {
                        $scope.error = err;
                        //show any notifications
                        if (angular.isArray(err.data.notifications)) {
                            for (var i = 0; i < err.data.notifications.length; i++) {
                                notificationsService.showNotification(err.data.notifications[i]);
                            }
                        }
                    });
                });
            }
        };
        // Disabling logic for creating document type with template if disableTemplates is set to true
        if (!disableTemplates) {
            $scope.createDocType = function () {
                $location.search('create', null);
                $location.search('notemplate', null);
                $location.path('/settings/documenttypes/edit/' + node.id).search('create', 'true');
                navigationService.hideMenu();
            };
        }
        $scope.createComponent = function () {
            $location.search('create', null);
            $location.search('notemplate', null);
            $location.path('/settings/documenttypes/edit/' + node.id).search('create', 'true').search('notemplate', 'true');
            navigationService.hideMenu();
        };
        $scope.close = function () {
            var showMenu = true;
            navigationService.hideDialog(showMenu);
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.DocumentTypes.CreateController', DocumentTypesCreateController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.DocumentType.DeleteController
 * @function
 *
 * @description
 * The controller for deleting content
 */
    function DocumentTypesDeleteController($scope, dataTypeResource, contentTypeResource, treeService, navigationService) {
        $scope.performDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            contentTypeResource.deleteById($scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                //TODO: Need to sync tree, etc...
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
            });
        };
        $scope.performContainerDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            contentTypeResource.deleteContainerById($scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                //TODO: Need to sync tree, etc...
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.DocumentTypes.DeleteController', DocumentTypesDeleteController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.DocumentType.EditController
 * @function
 *
 * @description
 * The controller for the content type editor
 */
    (function () {
        'use strict';
        function DocumentTypesEditController($scope, $routeParams, contentTypeResource, dataTypeResource, editorState, contentEditingHelper, formHelper, navigationService, iconHelper, contentTypeHelper, notificationsService, $q, localizationService, overlayHelper, eventsService, angularHelper, editorService) {
            var vm = this;
            var evts = [];
            var disableTemplates = Umbraco.Sys.ServerVariables.features.disabledFeatures.disableTemplates;
            var documentTypeId = $routeParams.id;
            var create = $routeParams.create;
            var noTemplate = $routeParams.notemplate;
            var infiniteMode = $scope.model && $scope.model.infiniteMode;
            vm.save = save;
            vm.close = close;
            vm.currentNode = null;
            vm.contentType = {};
            vm.labels = {};
            vm.submitButtonKey = 'buttons_save';
            vm.generateModelsKey = 'buttons_saveAndGenerateModels';
            vm.page = {};
            vm.page.loading = false;
            vm.page.saveButtonState = 'init';
            vm.page.navigation = [];
            var labelKeys = [
                'general_design',
                'general_listView',
                'general_rights',
                'treeHeaders_templates',
                'main_sections',
                'shortcuts_navigateSections',
                'shortcuts_addTab',
                'shortcuts_addProperty',
                'shortcuts_addEditor',
                'shortcuts_editDataType',
                'shortcuts_toggleListView',
                'shortcuts_toggleAllowAsRoot',
                'shortcuts_addChildNode',
                'shortcuts_addTemplate',
                'shortcuts_toggleAllowCultureVariants'
            ];
            onInit();
            function onInit() {
                // get init values from model when in infinite mode
                if (infiniteMode) {
                    documentTypeId = $scope.model.id;
                    create = $scope.model.create;
                    noTemplate = $scope.model.notemplate;
                    vm.submitButtonKey = 'buttons_saveAndClose';
                    vm.generateModelsKey = 'buttons_generateModelsAndClose';
                }
            }
            localizationService.localizeMany(labelKeys).then(function (values) {
                // navigation
                vm.labels.design = values[0];
                vm.labels.listview = values[1];
                vm.labels.permissions = values[2];
                vm.labels.templates = values[3];
                // keyboard shortcuts
                vm.labels.sections = values[4];
                vm.labels.navigateSections = values[5];
                vm.labels.addTab = values[6];
                vm.labels.addProperty = values[7];
                vm.labels.addEditor = values[8];
                vm.labels.editDataType = values[9];
                vm.labels.toggleListView = values[10];
                vm.labels.allowAsRoot = values[11];
                vm.labels.addChildNode = values[12];
                vm.labels.addTemplate = values[13];
                vm.labels.allowCultureVariants = values[14];
                var buttons = [
                    {
                        'name': vm.labels.design,
                        'alias': 'design',
                        'icon': 'icon-document-dashed-line',
                        'view': 'views/documenttypes/views/design/design.html',
                        'active': true
                    },
                    {
                        'name': vm.labels.listview,
                        'alias': 'listView',
                        'icon': 'icon-list',
                        'view': 'views/documenttypes/views/listview/listview.html'
                    },
                    {
                        'name': vm.labels.permissions,
                        'alias': 'permissions',
                        'icon': 'icon-keychain',
                        'view': 'views/documenttypes/views/permissions/permissions.html'
                    },
                    {
                        'name': vm.labels.templates,
                        'alias': 'templates',
                        'icon': 'icon-layout',
                        'view': 'views/documenttypes/views/templates/templates.html'
                    }
                ];
                vm.page.keyboardShortcutsOverview = [
                    {
                        'name': vm.labels.sections,
                        'shortcuts': [{
                                'description': vm.labels.navigateSections,
                                'keys': [
                                    { 'key': '1' },
                                    { 'key': '4' }
                                ],
                                'keyRange': true
                            }]
                    },
                    {
                        'name': vm.labels.design,
                        'shortcuts': [
                            {
                                'description': vm.labels.addTab,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 't' }
                                ]
                            },
                            {
                                'description': vm.labels.addProperty,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'p' }
                                ]
                            },
                            {
                                'description': vm.labels.addEditor,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'e' }
                                ]
                            },
                            {
                                'description': vm.labels.editDataType,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'd' }
                                ]
                            }
                        ]
                    },
                    {
                        'name': vm.labels.listview,
                        'shortcuts': [{
                                'description': vm.labels.toggleListView,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'l' }
                                ]
                            }]
                    },
                    {
                        'name': vm.labels.permissions,
                        'shortcuts': [
                            {
                                'description': vm.labels.allowAsRoot,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'r' }
                                ]
                            },
                            {
                                'description': vm.labels.addChildNode,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'c' }
                                ]
                            },
                            {
                                'description': vm.labels.allowCultureVariants,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'v' }
                                ]
                            }
                        ]
                    },
                    {
                        'name': vm.labels.templates,
                        'shortcuts': [{
                                'description': vm.labels.addTemplate,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 't' }
                                ]
                            }]
                    }
                ];
                loadButtons(buttons);
            });
            contentTypeHelper.checkModelsBuilderStatus().then(function (result) {
                vm.page.modelsBuilder = result;
                if (result) {
                    //Models builder mode:
                    vm.page.defaultButton = {
                        alias: 'save',
                        hotKey: 'ctrl+s',
                        hotKeyWhenHidden: true,
                        labelKey: vm.submitButtonKey,
                        letter: 'S',
                        type: 'submit',
                        handler: function handler() {
                            vm.save();
                        }
                    };
                    vm.page.subButtons = [{
                            alias: 'saveAndGenerateModels',
                            hotKey: 'ctrl+g',
                            hotKeyWhenHidden: true,
                            labelKey: vm.generateModelsKey,
                            letter: 'G',
                            handler: function handler() {
                                vm.page.saveButtonState = 'busy';
                                saveInternal().then(function (result) {
                                    vm.page.saveButtonState = 'busy';
                                    localizationService.localize('modelsBuilder_buildingModels').then(function (headerValue) {
                                        localizationService.localize('modelsBuilder_waitingMessage').then(function (msgValue) {
                                            notificationsService.info(headerValue, msgValue);
                                        });
                                    });
                                    contentTypeHelper.generateModels().then(function (result) {
                                        // generateModels() returns the dashboard content
                                        if (!result.lastError) {
                                            //re-check model status
                                            contentTypeHelper.checkModelsBuilderStatus().then(function (statusResult) {
                                                vm.page.modelsBuilder = statusResult;
                                            });
                                            //clear and add success
                                            vm.page.saveButtonState = 'init';
                                            localizationService.localize('modelsBuilder_modelsGenerated').then(function (value) {
                                                notificationsService.success(value);
                                            });
                                        } else {
                                            vm.page.saveButtonState = 'error';
                                            localizationService.localize('modelsBuilder_modelsExceptionInUlog').then(function (value) {
                                                notificationsService.error(value);
                                            });
                                        }
                                    }, function () {
                                        vm.page.saveButtonState = 'error';
                                        localizationService.localize('modelsBuilder_modelsGeneratedError').then(function (value) {
                                            notificationsService.error(value);
                                        });
                                    });
                                });
                            }
                        }];
                }
            });
            if (create) {
                vm.page.loading = true;
                //we are creating so get an empty data type item
                contentTypeResource.getScaffold(documentTypeId).then(function (dt) {
                    init(dt);
                    vm.page.loading = false;
                });
            } else {
                loadDocumentType();
            }
            function loadDocumentType() {
                vm.page.loading = true;
                contentTypeResource.getById(documentTypeId).then(function (dt) {
                    init(dt);
                    // we don't need to sync the tree in infinite mode
                    if (!infiniteMode) {
                        syncTreeNode(vm.contentType, dt.path, true);
                    }
                    vm.page.loading = false;
                });
            }
            function loadButtons(buttons) {
                angular.forEach(buttons, function (val, index) {
                    if (disableTemplates === true && val.alias === 'templates') {
                        buttons.splice(index, 1);
                    }
                });
                vm.page.navigation = buttons;
            }
            /* ---------- SAVE ---------- */
            function save() {
                saveInternal().then(angular.noop, angular.noop);
            }
            /** This internal save method performs the actual saving and returns a promise, not to be bound to any buttons but used by other bound methods */
            function saveInternal() {
                // only save if there are no dialogs open
                if (overlayHelper.getNumberOfOverlays() === 0 && (editorService.getNumberOfEditors() === 0 || infiniteMode)) {
                    vm.page.saveButtonState = 'busy';
                    // reformat allowed content types to array if id's
                    vm.contentType.allowedContentTypes = contentTypeHelper.createIdArray(vm.contentType.allowedContentTypes);
                    //if this is a new item and it's creating a template, ensure that the template alias is synced correctly
                    syncTemplateAlias(vm.contentType);
                    return contentEditingHelper.contentEditorPerformSave({
                        saveMethod: contentTypeResource.save,
                        scope: $scope,
                        content: vm.contentType,
                        //We do not redirect on failure for doc types - this is because it is not possible to actually save the doc
                        // type when server side validation fails - as opposed to content where we are capable of saving the content
                        // item if server side validation fails
                        redirectOnFailure: false,
                        // we need to rebind... the IDs that have been created!
                        rebindCallback: function rebindCallback(origContentType, savedContentType) {
                            vm.contentType.id = savedContentType.id;
                            vm.contentType.groups.forEach(function (group) {
                                if (!group.name)
                                    return;
                                var k = 0;
                                while (k < savedContentType.groups.length && savedContentType.groups[k].name != group.name) {
                                    k++;
                                }
                                if (k == savedContentType.groups.length) {
                                    group.id = 0;
                                    return;
                                }
                                var savedGroup = savedContentType.groups[k];
                                if (!group.id)
                                    group.id = savedGroup.id;
                                group.properties.forEach(function (property) {
                                    if (property.id || !property.alias)
                                        return;
                                    k = 0;
                                    while (k < savedGroup.properties.length && savedGroup.properties[k].alias != property.alias) {
                                        k++;
                                    }
                                    if (k == savedGroup.properties.length) {
                                        property.id = 0;
                                        return;
                                    }
                                    var savedProperty = savedGroup.properties[k];
                                    property.id = savedProperty.id;
                                });
                            });
                        }
                    }).then(function (data) {
                        //success
                        // we don't need to sync the tree in infinite mode
                        if (!infiniteMode) {
                            syncTreeNode(vm.contentType, data.path);
                        }
                        // emit event
                        var args = { documentType: vm.contentType };
                        eventsService.emit('editors.documentType.saved', args);
                        vm.page.saveButtonState = 'success';
                        if (infiniteMode && $scope.model.submit) {
                            $scope.model.documentTypeAlias = vm.contentType.alias;
                            $scope.model.submit($scope.model);
                        }
                        return $q.resolve(data);
                    }, function (err) {
                        //error
                        if (err) {
                            editorState.set($scope.content);
                        } else {
                            localizationService.localize('speechBubbles_validationFailedHeader').then(function (headerValue) {
                                localizationService.localize('speechBubbles_validationFailedMessage').then(function (msgValue) {
                                    notificationsService.error(headerValue, msgValue);
                                });
                            });
                        }
                        vm.page.saveButtonState = 'error';
                        return $q.reject(err);
                    });
                } else {
                    return $q.reject();
                }
            }
            function init(contentType) {
                // set all tab to inactive
                if (contentType.groups.length !== 0) {
                    angular.forEach(contentType.groups, function (group) {
                        angular.forEach(group.properties, function (property) {
                            // get data type details for each property
                            getDataTypeDetails(property);
                        });
                    });
                }
                // insert template on new doc types
                if (!noTemplate && contentType.id === 0) {
                    contentType.defaultTemplate = contentTypeHelper.insertDefaultTemplatePlaceholder(contentType.defaultTemplate);
                    contentType.allowedTemplates = contentTypeHelper.insertTemplatePlaceholder(contentType.allowedTemplates);
                }
                // convert icons for content type
                convertLegacyIcons(contentType);
                //set a shared state
                editorState.set(contentType);
                vm.contentType = contentType;
            }
            /** Syncs the template alias for new doc types before saving if a template is to be created */
            function syncTemplateAlias(contentType) {
                if (!noTemplate && contentType.id === 0) {
                    //sync default template that had the placeholder flag
                    if (contentType.defaultTemplate !== null && contentType.defaultTemplate.placeholder) {
                        contentType.defaultTemplate.name = contentType.name;
                        contentType.defaultTemplate.alias = contentType.alias;
                    }
                    //sync allowed templates that had the placeholder flag
                    angular.forEach(contentType.allowedTemplates, function (allowedTemplate) {
                        if (allowedTemplate.placeholder) {
                            allowedTemplate.name = contentType.name;
                            allowedTemplate.alias = contentType.alias;
                        }
                    });
                }
            }
            function convertLegacyIcons(contentType) {
                // make array to store contentType icon
                var contentTypeArray = [];
                // push icon to array
                contentTypeArray.push({ 'icon': contentType.icon });
                // run through icon method
                iconHelper.formatContentTypeIcons(contentTypeArray);
                // set icon back on contentType
                contentType.icon = contentTypeArray[0].icon;
            }
            function getDataTypeDetails(property) {
                if (property.propertyState !== 'init') {
                    dataTypeResource.getById(property.dataTypeId).then(function (dataType) {
                        property.dataTypeIcon = dataType.icon;
                        property.dataTypeName = dataType.name;
                    });
                }
            }
            /** Syncs the content type  to it's tree node - this occurs on first load and after saving */
            function syncTreeNode(dt, path, initialLoad) {
                var args = {
                    tree: 'documenttypes',
                    path: path.split(','),
                    forceReload: initialLoad !== true
                };
                navigationService.syncTree(args).then(function (syncArgs) {
                    vm.currentNode = syncArgs.node;
                });
            }
            function close() {
                if ($scope.model.close) {
                    $scope.model.close($scope.model);
                }
            }
            evts.push(eventsService.on('app.refreshEditor', function (name, error) {
                loadDocumentType();
            }));
            //ensure to unregister from all events!
            $scope.$on('$destroy', function () {
                for (var e in evts) {
                    eventsService.unsubscribe(evts[e]);
                }
            });
            // #3368 - changes on the other "buttons" do not register on the current form, so we manually have to flag the form as dirty 
            $scope.$watch('vm.contentType.allowedContentTypes.length + vm.contentType.allowAsRoot + vm.contentType.allowedTemplates.length + vm.contentType.isContainer', function (newVal, oldVal) {
                if (oldVal === undefined) {
                    // still initializing, ignore
                    return;
                }
                angularHelper.getCurrentForm($scope).$setDirty();
            });
        }
        angular.module('umbraco').controller('Umbraco.Editors.DocumentTypes.EditController', DocumentTypesEditController);
    }());
    'use strict';
    angular.module('umbraco').controller('Umbraco.Editors.DocumentTypes.ExportController', function ($scope, contentTypeResource, navigationService) {
        $scope.export = function () {
            contentTypeResource.export($scope.currentNode.id);
            navigationService.hideMenu();
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    });
    'use strict';
    angular.module('umbraco').controller('Umbraco.Editors.DocumentTypes.ImportController', function ($scope, contentTypeResource, navigationService, Upload, umbRequestHelper) {
        var vm = this;
        vm.serverErrorMessage = '';
        vm.state = 'upload';
        vm.model = {};
        vm.uploadStatus = '';
        $scope.handleFiles = function (files, event) {
            if (files && files.length > 0) {
                $scope.upload(files[0]);
            }
        };
        $scope.upload = function (file) {
            Upload.upload({
                url: umbRequestHelper.getApiUrl('contentTypeApiBaseUrl', 'Upload'),
                fields: {},
                file: file
            }).success(function (data, status, headers, config) {
                if (data.notifications && data.notifications.length > 0) {
                    // set error status on file
                    vm.uploadStatus = 'error';
                    // Throw message back to user with the cause of the error
                    vm.serverErrorMessage = data.notifications[0].message;
                } else {
                    // set done status on file
                    vm.uploadStatus = 'done';
                    vm.model = data;
                    vm.state = 'confirm';
                }
            }).error(function (evt, status, headers, config) {
                // set status done
                $scope.uploadStatus = 'error';
                // If file not found, server will return a 404 and display this message
                if (status === 404) {
                    $scope.serverErrorMessage = 'File not found';
                } else if (status == 400) {
                    //it's a validation error
                    $scope.serverErrorMessage = evt.message;
                } else {
                    //it's an unhandled error
                    //if the service returns a detailed error
                    if (evt.InnerException) {
                        $scope.serverErrorMessage = evt.InnerException.ExceptionMessage;
                        //Check if its the common "too large file" exception
                        if (evt.InnerException.StackTrace && evt.InnerException.StackTrace.indexOf('ValidateRequestEntityLength') > 0) {
                            $scope.serverErrorMessage = 'File too large to upload';
                        }
                    } else if (evt.Message) {
                        $scope.serverErrorMessage = evt.Message;
                    }
                }
            });
        };
        $scope.import = function () {
            contentTypeResource.import(vm.model.tempFileName);
            vm.state = 'done';
        };
        $scope.close = function () {
            navigationService.hideDialog();
        };
    });
    'use strict';
    angular.module('umbraco').controller('Umbraco.Editors.DocumentTypes.MoveController', function ($scope, contentTypeResource, treeService, navigationService, notificationsService, appState, eventsService) {
        $scope.dialogTreeApi = {};
        $scope.source = _.clone($scope.currentNode);
        function nodeSelectHandler(args) {
            args.event.preventDefault();
            args.event.stopPropagation();
            if ($scope.target) {
                //un-select if there's a current one selected
                $scope.target.selected = false;
            }
            $scope.target = args.node;
            $scope.target.selected = true;
        }
        $scope.move = function () {
            $scope.busy = true;
            $scope.error = false;
            contentTypeResource.move({
                parentId: $scope.target.id,
                id: $scope.source.id
            }).then(function (path) {
                $scope.error = false;
                $scope.success = true;
                $scope.busy = false;
                //first we need to remove the node that launched the dialog
                treeService.removeNode($scope.currentNode);
                //get the currently edited node (if any)
                var activeNode = appState.getTreeState('selectedNode');
                //we need to do a double sync here: first sync to the moved content - but don't activate the node,
                //then sync to the currenlty edited content (note: this might not be the content that was moved!!)
                navigationService.syncTree({
                    tree: 'documentTypes',
                    path: path,
                    forceReload: true,
                    activate: false
                }).then(function (args) {
                    if (activeNode) {
                        var activeNodePath = treeService.getPath(activeNode).join();
                        //sync to this node now - depending on what was copied this might already be synced but might not be
                        navigationService.syncTree({
                            tree: 'documentTypes',
                            path: activeNodePath,
                            forceReload: false,
                            activate: true
                        });
                    }
                });
                eventsService.emit('app.refreshEditor');
            }, function (err) {
                $scope.success = false;
                $scope.error = err;
                $scope.busy = false;
            });
        };
        $scope.onTreeInit = function () {
            $scope.dialogTreeApi.callbacks.treeNodeSelect(nodeSelectHandler);
        };
        $scope.close = function () {
            navigationService.hideDialog();
        };
    });
    'use strict';
    angular.module('umbraco').controller('Umbraco.Editors.ContentTypeContainers.RenameController', function ($scope, $injector, navigationService, notificationsService, localizationService) {
        var notificationHeader;
        function reportSuccessAndClose(treeName) {
            var lastComma = $scope.currentNode.path.lastIndexOf(','), path = lastComma === -1 ? $scope.currentNode.path : $scope.currentNode.path.substring(0, lastComma - 1);
            navigationService.syncTree({
                tree: treeName,
                path: path,
                forceReload: true,
                activate: true
            });
            localizationService.localize('renamecontainer_folderWasRenamed', [
                $scope.currentNode.name,
                $scope.model.folderName
            ]).then(function (msg) {
                notificationsService.showNotification({
                    type: 0,
                    header: notificationHeader,
                    message: msg
                });
            });
            navigationService.hideMenu();
        }
        localizationService.localize('renamecontainer_renamed').then(function (s) {
            notificationHeader = s;
        });
        $scope.model = { folderName: $scope.currentNode.name };
        $scope.renameContainer = function (resourceKey, treeName) {
            var resource = $injector.get(resourceKey);
            resource.renameContainer($scope.currentNode.id, $scope.model.folderName).then(function () {
                reportSuccessAndClose(treeName);
            }, function (err) {
                $scope.error = err;
            });
        };
    });
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.DocumentType.PropertyController
 * @function
 *
 * @description
 * The controller for the content type editor property dialog
 */
    (function () {
        'use strict';
        function PermissionsController($scope, contentTypeResource, iconHelper, contentTypeHelper, localizationService, overlayService) {
            /* ----------- SCOPE VARIABLES ----------- */
            var vm = this;
            var childNodeSelectorOverlayTitle = '';
            vm.contentTypes = [];
            vm.selectedChildren = [];
            vm.overlayTitle = '';
            vm.addChild = addChild;
            vm.removeChild = removeChild;
            vm.toggleAllowAsRoot = toggleAllowAsRoot;
            vm.toggleAllowCultureVariants = toggleAllowCultureVariants;
            /* ---------- INIT ---------- */
            init();
            function init() {
                localizationService.localize('contentTypeEditor_chooseChildNode').then(function (value) {
                    childNodeSelectorOverlayTitle = value;
                });
                contentTypeResource.getAll().then(function (contentTypes) {
                    vm.contentTypes = contentTypes;
                    // convert legacy icons
                    iconHelper.formatContentTypeIcons(vm.contentTypes);
                    vm.selectedChildren = contentTypeHelper.makeObjectArrayFromId($scope.model.allowedContentTypes, vm.contentTypes);
                    if ($scope.model.id === 0) {
                        contentTypeHelper.insertChildNodePlaceholder(vm.contentTypes, $scope.model.name, $scope.model.icon, $scope.model.id);
                    }
                });
            }
            function addChild($event) {
                var childNodeSelectorOverlay = {
                    view: 'itempicker',
                    title: childNodeSelectorOverlayTitle,
                    availableItems: vm.contentTypes,
                    selectedItems: vm.selectedChildren,
                    position: 'target',
                    event: $event,
                    submit: function submit(model) {
                        vm.selectedChildren.push(model.selectedItem);
                        $scope.model.allowedContentTypes.push(model.selectedItem.id);
                        overlayService.close();
                    },
                    close: function close() {
                        overlayService.close();
                    }
                };
                overlayService.open(childNodeSelectorOverlay);
            }
            function removeChild(selectedChild, index) {
                // remove from vm
                vm.selectedChildren.splice(index, 1);
                // remove from content type model
                var selectedChildIndex = $scope.model.allowedContentTypes.indexOf(selectedChild.id);
                $scope.model.allowedContentTypes.splice(selectedChildIndex, 1);
            }
            /**
     * Toggle the $scope.model.allowAsRoot value to either true or false
     */
            function toggleAllowAsRoot() {
                if ($scope.model.allowAsRoot) {
                    $scope.model.allowAsRoot = false;
                    return;
                }
                $scope.model.allowAsRoot = true;
            }
            function toggleAllowCultureVariants() {
                if ($scope.model.allowCultureVariant) {
                    $scope.model.allowCultureVariant = false;
                    return;
                }
                $scope.model.allowCultureVariant = true;
            }
        }
        angular.module('umbraco').controller('Umbraco.Editors.DocumentType.PermissionsController', PermissionsController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.DocumentType.TemplatesController
 * @function
 *
 * @description
 * The controller for the content type editor templates sub view
 */
    (function () {
        'use strict';
        function TemplatesController($scope, entityResource, contentTypeHelper, templateResource, $routeParams) {
            /* ----------- SCOPE VARIABLES ----------- */
            var vm = this;
            vm.availableTemplates = [];
            vm.canCreateTemplate = false;
            vm.updateTemplatePlaceholder = false;
            vm.loadingTemplates = false;
            vm.createTemplate = createTemplate;
            /* ---------- INIT ---------- */
            function onInit() {
                vm.loadingTemplates = true;
                entityResource.getAll('Template').then(function (templates) {
                    vm.availableTemplates = templates;
                    // update placeholder template information on new doc types
                    if (!$routeParams.notemplate && $scope.model.id === 0) {
                        vm.updateTemplatePlaceholder = true;
                        vm.availableTemplates = contentTypeHelper.insertTemplatePlaceholder(vm.availableTemplates);
                    }
                    vm.loadingTemplates = false;
                    checkIfTemplateExists();
                });
            }
            function createTemplate() {
                vm.createTemplateButtonState = 'busy';
                templateResource.getScaffold(-1).then(function (template) {
                    template.alias = $scope.model.alias;
                    template.name = $scope.model.name;
                    templateResource.save(template).then(function (savedTemplate) {
                        // add icon
                        savedTemplate.icon = 'icon-layout';
                        vm.availableTemplates.push(savedTemplate);
                        vm.canCreateTemplate = false;
                        $scope.model.allowedTemplates.push(savedTemplate);
                        if ($scope.model.defaultTemplate === null) {
                            $scope.model.defaultTemplate = savedTemplate;
                        }
                        vm.createTemplateButtonState = 'success';
                    }, function () {
                        vm.createTemplateButtonState = 'error';
                    });
                }, function () {
                    vm.createTemplateButtonState = 'error';
                });
            }
            ;
            function checkIfTemplateExists() {
                var existingTemplate = vm.availableTemplates.find(function (availableTemplate) {
                    return availableTemplate.name === $scope.model.name || availableTemplate.placeholder;
                });
                vm.canCreateTemplate = existingTemplate ? false : true;
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.DocumentType.TemplatesController', TemplatesController);
    }());
    'use strict';
    (function () {
        'use strict';
        function LanguagesEditController($scope, $timeout, $location, $routeParams, navigationService, notificationsService, localizationService, languageResource, contentEditingHelper, formHelper, eventsService) {
            var vm = this;
            vm.page = {};
            vm.showBackButton = true;
            vm.language = {};
            vm.availableCultures = null;
            vm.breadcrumbs = [];
            vm.labels = {};
            vm.initIsDefault = false;
            vm.showDefaultLanguageInfo = false;
            vm.save = save;
            vm.back = back;
            vm.goToPage = goToPage;
            vm.toggleMandatory = toggleMandatory;
            vm.toggleDefault = toggleDefault;
            function init() {
                // localize labels
                var labelKeys = [
                    'treeHeaders_languages',
                    'languages_mandatoryLanguage',
                    'languages_mandatoryLanguageHelp',
                    'languages_defaultLanguage',
                    'languages_defaultLanguageHelp',
                    'languages_addLanguage',
                    'languages_noFallbackLanguageOption',
                    'languages_fallbackLanguageDescription',
                    'languages_fallbackLanguage'
                ];
                localizationService.localizeMany(labelKeys).then(function (values) {
                    vm.labels.languages = values[0];
                    vm.labels.mandatoryLanguage = values[1];
                    vm.labels.mandatoryLanguageHelp = values[2];
                    vm.labels.defaultLanguage = values[3];
                    vm.labels.defaultLanguageHelp = values[4];
                    vm.labels.addLanguage = values[5];
                    vm.labels.noFallbackLanguageOption = values[6];
                    $scope.properties = {
                        fallbackLanguage: {
                            alias: 'fallbackLanguage',
                            description: values[7],
                            label: values[8]
                        }
                    };
                    if ($routeParams.create) {
                        vm.page.name = vm.labels.addLanguage;
                        languageResource.getCultures().then(function (culturesDictionary) {
                            var cultures = [];
                            angular.forEach(culturesDictionary, function (value, key) {
                                cultures.push({
                                    name: key,
                                    displayName: value
                                });
                            });
                            vm.availableCultures = cultures;
                        });
                    }
                });
                vm.loading = true;
                languageResource.getAll().then(function (languages) {
                    vm.availableLanguages = languages.filter(function (l) {
                        return $routeParams.id != l.id;
                    });
                    vm.loading = false;
                });
                if (!$routeParams.create) {
                    vm.loading = true;
                    languageResource.getById($routeParams.id).then(function (lang) {
                        vm.language = lang;
                        vm.page.name = vm.language.name;
                        /* we need to store the initial default state so we can disabel the toggle if it is the default.
          we need to prevent from not having a default language. */
                        vm.initIsDefault = angular.copy(vm.language.isDefault);
                        vm.loading = false;
                        makeBreadcrumbs();
                    });
                }
                $timeout(function () {
                    navigationService.syncTree({
                        tree: 'languages',
                        path: '-1'
                    });
                });
            }
            function save() {
                if (formHelper.submitForm({ scope: $scope })) {
                    vm.page.saveButtonState = 'busy';
                    languageResource.save(vm.language).then(function (lang) {
                        formHelper.resetForm({ scope: $scope });
                        vm.language = lang;
                        vm.page.saveButtonState = 'success';
                        localizationService.localize('speechBubbles_languageSaved').then(function (value) {
                            notificationsService.success(value);
                        });
                        // emit event when language is created or updated/saved
                        var args = {
                            language: lang,
                            isNew: $routeParams.create ? true : false
                        };
                        eventsService.emit('editors.languages.languageSaved', args);
                        back();
                    }, function (err) {
                        vm.page.saveButtonState = 'error';
                        formHelper.handleError(err);
                    });
                }
            }
            function back() {
                $location.path('settings/languages/overview');
            }
            function goToPage(ancestor) {
                $location.path(ancestor.path);
            }
            function toggleMandatory() {
                vm.language.isMandatory = !vm.language.isMandatory;
            }
            function toggleDefault() {
                // it shouldn't be possible to uncheck the default language
                if (vm.initIsDefault) {
                    return;
                }
                vm.language.isDefault = !vm.language.isDefault;
                if (vm.language.isDefault) {
                    vm.showDefaultLanguageInfo = true;
                } else {
                    vm.showDefaultLanguageInfo = false;
                }
            }
            function makeBreadcrumbs() {
                vm.breadcrumbs = [
                    {
                        'name': vm.labels.languages,
                        'path': '/settings/languages/overview'
                    },
                    { 'name': vm.language.name }
                ];
            }
            init();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Languages.EditController', LanguagesEditController);
    }());
    'use strict';
    (function () {
        'use strict';
        function LanguagesOverviewController($location, $timeout, navigationService, notificationsService, localizationService, languageResource, eventsService) {
            var vm = this;
            vm.page = {};
            vm.languages = [];
            vm.labels = {};
            vm.addLanguage = addLanguage;
            vm.editLanguage = editLanguage;
            vm.deleteLanguage = deleteLanguage;
            vm.getLanguageById = function (id) {
                for (var i = 0; i < vm.languages.length; i++) {
                    if (vm.languages[i].id === id) {
                        return vm.languages[i];
                    }
                }
                return null;
            };
            function init() {
                vm.loading = true;
                // localize labels
                var labelKeys = [
                    'treeHeaders_languages',
                    'general_mandatory',
                    'general_default',
                    'languages_fallsbackToLabel'
                ];
                localizationService.localizeMany(labelKeys).then(function (values) {
                    vm.labels.languages = values[0];
                    vm.labels.mandatory = values[1];
                    vm.labels.general = values[2];
                    vm.labels.fallsbackTo = values[3];
                    // set page name
                    vm.page.name = vm.labels.languages;
                });
                languageResource.getAll().then(function (languages) {
                    vm.languages = languages;
                    vm.loading = false;
                });
                $timeout(function () {
                    navigationService.syncTree({
                        tree: 'languages',
                        path: '-1'
                    });
                });
            }
            function addLanguage() {
                $location.search('create', null);
                $location.path('/settings/languages/edit/-1').search('create', 'true');
            }
            function editLanguage(language) {
                $location.search('create', null);
                $location.path('/settings/languages/edit/' + language.id);
            }
            function deleteLanguage(language, event) {
                var confirmed = confirm('Are you sure you want to delete ' + language.name + '?');
                if (confirmed) {
                    language.deleteButtonState = 'busy';
                    languageResource.deleteById(language.id).then(function () {
                        // emit event
                        var args = { language: language };
                        eventsService.emit('editors.languages.languageDeleted', args);
                        // remove from list
                        var index = vm.languages.indexOf(language);
                        vm.languages.splice(index, 1);
                    }, function (err) {
                        language.deleteButtonState = 'error';
                    });
                }
                event.preventDefault();
                event.stopPropagation();
            }
            init();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Languages.OverviewController', LanguagesOverviewController);
    }());
    'use strict';
    (function () {
        'use strict';
        function MediaAppContentController($scope) {
            var vm = this;
        }
        angular.module('umbraco').controller('Umbraco.Editors.Media.Apps.ContentController', MediaAppContentController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Media.CreateController
 * @function
 * 
 * @description
 * The controller for the media creation dialog
 */
    function mediaCreateController($scope, $routeParams, $location, mediaTypeResource, iconHelper, navigationService) {
        mediaTypeResource.getAllowedTypes($scope.currentNode.id).then(function (data) {
            $scope.allowedTypes = iconHelper.formatContentTypeIcons(data);
        });
        $scope.createMediaItem = function (docType) {
            $location.path('/media/media/edit/' + $scope.currentNode.id).search('doctype', docType.alias).search('create', 'true');
            navigationService.hideMenu();
        };
        $scope.close = function () {
            var showMenu = true;
            navigationService.hideDialog(showMenu);
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.Media.CreateController', mediaCreateController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.ContentDeleteController
 * @function
 * 
 * @description
 * The controller for deleting content
 */
    function MediaDeleteController($scope, mediaResource, treeService, navigationService, editorState, $location, overlayService) {
        $scope.performDelete = function () {
            // stop from firing again on double-click
            if ($scope.busy) {
                return false;
            }
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            $scope.busy = true;
            mediaResource.deleteById($scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                treeService.removeNode($scope.currentNode);
                if (rootNode) {
                    //ensure the recycle bin has child nodes now            
                    var recycleBin = treeService.getDescendantNode(rootNode, -21);
                    if (recycleBin) {
                        recycleBin.hasChildren = true;
                        //reload the recycle bin if it's already expanded so the deleted item is shown
                        if (recycleBin.expanded) {
                            treeService.loadNodeChildren({
                                node: recycleBin,
                                section: 'media'
                            });
                        }
                    }
                }
                //if the current edited item is the same one as we're deleting, we need to navigate elsewhere
                if (editorState.current && editorState.current.id == $scope.currentNode.id) {
                    //If the deleted item lived at the root then just redirect back to the root, otherwise redirect to the item's parent
                    var location = '/media';
                    if ($scope.currentNode.parentId.toString() === '-21')
                        location = '/media/media/recyclebin';
                    else if ($scope.currentNode.parentId.toString() !== '-1')
                        location = '/media/media/edit/' + $scope.currentNode.parentId;
                    $location.path(location);
                }
                navigationService.hideMenu();
            }, function (err) {
                $scope.currentNode.loading = false;
                $scope.busy = false;
                //check if response is ysod
                if (err.status && err.status >= 500) {
                    overlayService.ysod(err);
                }
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.Media.DeleteController', MediaDeleteController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Media.EditController
 * @function
 * 
 * @description
 * The controller for the media editor
 */
    function mediaEditController($scope, $routeParams, $q, appState, mediaResource, entityResource, navigationService, notificationsService, angularHelper, serverValidationManager, contentEditingHelper, fileManager, formHelper, editorState, umbRequestHelper, $http, eventsService) {
        var evts = [];
        var nodeId = null;
        var create = false;
        var infiniteMode = $scope.model && $scope.model.infiniteMode;
        // when opening the editor through infinite editing get the 
        // node id from the model instead of the route param
        if (infiniteMode && $scope.model.id) {
            nodeId = $scope.model.id;
        } else {
            nodeId = $routeParams.id;
        }
        // when opening the editor through infinite editing get the 
        // create option from the model instead of the route param
        if (infiniteMode) {
            create = $scope.model.create;
        } else {
            create = $routeParams.create;
        }
        //setup scope vars
        $scope.currentSection = appState.getSectionState('currentSection');
        $scope.currentNode = null;
        //the editors affiliated node
        $scope.page = {};
        $scope.page.loading = false;
        $scope.page.menu = {};
        $scope.page.menu.currentSection = appState.getSectionState('currentSection');
        $scope.page.menu.currentNode = null;
        //the editors affiliated node
        $scope.page.listViewPath = null;
        $scope.page.saveButtonState = 'init';
        $scope.page.submitButtonLabel = 'Save';
        /** Syncs the content item to it's tree node - this occurs on first load and after saving */
        function syncTreeNode(content, path, initialLoad) {
            if (infiniteMode) {
                return;
            }
            if (!$scope.content.isChildOfListView) {
                navigationService.syncTree({
                    tree: 'media',
                    path: path.split(','),
                    forceReload: initialLoad !== true
                }).then(function (syncArgs) {
                    $scope.page.menu.currentNode = syncArgs.node;
                });
            } else if (initialLoad === true) {
                //it's a child item, just sync the ui node to the parent
                navigationService.syncTree({
                    tree: 'media',
                    path: path.substring(0, path.lastIndexOf(',')).split(','),
                    forceReload: initialLoad !== true
                });
                //if this is a child of a list view and it's the initial load of the editor, we need to get the tree node 
                // from the server so that we can load in the actions menu.
                umbRequestHelper.resourcePromise($http.get(content.treeNodeUrl), 'Failed to retrieve data for child node ' + content.id).then(function (node) {
                    $scope.page.menu.currentNode = node;
                });
            }
        }
        if (create) {
            $scope.page.loading = true;
            mediaResource.getScaffold(nodeId, $routeParams.doctype).then(function (data) {
                $scope.content = data;
                editorState.set($scope.content);
                init();
                $scope.page.loading = false;
            });
        } else {
            $scope.page.loading = true;
            loadMedia().then(function () {
                $scope.page.loading = false;
            });
        }
        function init() {
            if (!$scope.app) {
                // set first app to active
                $scope.content.apps[0].active = true;
                $scope.app = $scope.content.apps[0];
            }
            // setup infinite mode
            if (infiniteMode) {
                $scope.page.submitButtonLabel = 'Save and Close';
            }
        }
        $scope.save = function () {
            if (!$scope.busy && formHelper.submitForm({ scope: $scope })) {
                $scope.busy = true;
                $scope.page.saveButtonState = 'busy';
                mediaResource.save($scope.content, create, fileManager.getFiles()).then(function (data) {
                    formHelper.resetForm({ scope: $scope });
                    contentEditingHelper.handleSuccessfulSave({
                        scope: $scope,
                        savedContent: data,
                        redirectOnSuccess: !infiniteMode,
                        rebindCallback: contentEditingHelper.reBindChangedProperties($scope.content, data)
                    });
                    editorState.set($scope.content);
                    $scope.busy = false;
                    syncTreeNode($scope.content, data.path);
                    init();
                    $scope.page.saveButtonState = 'success';
                    // close the editor if it's infinite mode
                    if (infiniteMode && $scope.model.submit) {
                        $scope.model.mediaNode = $scope.content;
                        $scope.model.submit($scope.model);
                    }
                }, function (err) {
                    contentEditingHelper.handleSaveError({
                        err: err,
                        redirectOnError: !infiniteMode,
                        rebindCallback: contentEditingHelper.reBindChangedProperties($scope.content, err.data)
                    });
                    editorState.set($scope.content);
                    $scope.busy = false;
                    $scope.page.saveButtonState = 'error';
                });
            } else {
                $scope.busy = false;
            }
        };
        function loadMedia() {
            return mediaResource.getById(nodeId).then(function (data) {
                $scope.content = data;
                if (data.isChildOfListView && data.trashed === false) {
                    $scope.page.listViewPath = $routeParams.page ? '/media/media/edit/' + data.parentId + '?page=' + $routeParams.page : '/media/media/edit/' + data.parentId;
                }
                editorState.set($scope.content);
                //in one particular special case, after we've created a new item we redirect back to the edit
                // route but there might be server validation errors in the collection which we need to display
                // after the redirect, so we will bind all subscriptions which will show the server validation errors
                // if there are any and then clear them so the collection no longer persists them.
                serverValidationManager.notifyAndClearAllSubscriptions();
                if (!infiniteMode) {
                    syncTreeNode($scope.content, data.path, true);
                }
                if ($scope.content.parentId && $scope.content.parentId != -1) {
                    //We fetch all ancestors of the node to generate the footer breadcrump navigation
                    entityResource.getAncestors(nodeId, 'media').then(function (anc) {
                        $scope.ancestors = anc;
                    });
                }
                init();
                $scope.page.loading = false;
                $q.resolve($scope.content);
            });
        }
        $scope.close = function () {
            if ($scope.model.close) {
                $scope.model.close($scope.model);
            }
        };
        $scope.appChanged = function (app) {
            $scope.app = app;
        };
        evts.push(eventsService.on('editors.mediaType.saved', function (name, args) {
            // if this media item uses the updated media type we need to reload the media item
            if (args && args.mediaType && args.mediaType.key === $scope.content.contentType.key) {
                loadMedia();
            }
        }));
        //ensure to unregister from all events!
        $scope.$on('$destroy', function () {
            for (var e in evts) {
                eventsService.unsubscribe(evts[e]);
            }
        });
    }
    angular.module('umbraco').controller('Umbraco.Editors.Media.EditController', mediaEditController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Media.EmptyRecycleBinController
 * @function
 * 
 * @description
 * The controller for deleting media
 */
    function MediaEmptyRecycleBinController($scope, mediaResource, treeService, navigationService, notificationsService, $route) {
        $scope.busy = false;
        $scope.performDelete = function () {
            //(used in the UI)
            $scope.busy = true;
            $scope.currentNode.loading = true;
            mediaResource.emptyRecycleBin($scope.currentNode.id).then(function (result) {
                $scope.busy = false;
                $scope.currentNode.loading = false;
                treeService.removeChildNodes($scope.currentNode);
                navigationService.hideMenu();
                //reload the current view
                $route.reload();
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.Media.EmptyRecycleBinController', MediaEmptyRecycleBinController);
    'use strict';
    //used for the media picker dialog
    angular.module('umbraco').controller('Umbraco.Editors.Media.MoveController', function ($scope, userService, eventsService, mediaResource, appState, treeService, navigationService) {
        $scope.dialogTreeApi = {};
        $scope.source = _.clone($scope.currentNode);
        $scope.busy = false;
        $scope.searchInfo = {
            searchFromId: null,
            searchFromName: null,
            showSearch: false,
            results: [],
            selectedSearchResults: []
        };
        $scope.treeModel = { hideHeader: false };
        userService.getCurrentUser().then(function (userData) {
            $scope.treeModel.hideHeader = userData.startMediaIds.length > 0 && userData.startMediaIds.indexOf(-1) == -1;
        });
        function treeLoadedHandler(args) {
            if ($scope.source && $scope.source.path) {
                $scope.dialogTreeApi.syncTree({
                    path: $scope.source.path,
                    activate: false
                });
            }
        }
        function nodeSelectHandler(args) {
            if (args && args.event) {
                args.event.preventDefault();
                args.event.stopPropagation();
            }
            eventsService.emit('editors.media.moveController.select', args);
            if ($scope.target) {
                //un-select if there's a current one selected
                $scope.target.selected = false;
            }
            $scope.target = args.node;
            $scope.target.selected = true;
        }
        function nodeExpandedHandler(args) {
            // open mini list view for list views
            if (args.node.metaData.isContainer) {
                openMiniListView(args.node);
            }
        }
        $scope.onTreeInit = function () {
            $scope.dialogTreeApi.callbacks.treeLoaded(treeLoadedHandler);
            $scope.dialogTreeApi.callbacks.treeNodeSelect(nodeSelectHandler);
            $scope.dialogTreeApi.callbacks.treeNodeExpanded(nodeExpandedHandler);
        };
        $scope.close = function () {
            navigationService.hideDialog();
        };
        $scope.hideSearch = function () {
            $scope.searchInfo.showSearch = false;
            $scope.searchInfo.searchFromId = null;
            $scope.searchInfo.searchFromName = null;
            $scope.searchInfo.results = [];
        };
        // method to select a search result 
        $scope.selectResult = function (evt, result) {
            result.selected = result.selected === true ? false : true;
            nodeSelectHandler({
                event: evt,
                node: result
            });
        };
        //callback when there are search results 
        $scope.onSearchResults = function (results) {
            $scope.searchInfo.results = results;
            $scope.searchInfo.showSearch = true;
        };
        $scope.move = function () {
            $scope.busy = true;
            mediaResource.move({
                parentId: $scope.target.id,
                id: $scope.source.id
            }).then(function (path) {
                $scope.busy = false;
                $scope.error = false;
                $scope.success = true;
                //first we need to remove the node that launched the dialog
                treeService.removeNode($scope.currentNode);
                //get the currently edited node (if any)
                var activeNode = appState.getTreeState('selectedNode');
                //we need to do a double sync here: first sync to the moved content - but don't activate the node,
                //then sync to the currenlty edited content (note: this might not be the content that was moved!!)
                navigationService.syncTree({
                    tree: 'media',
                    path: path,
                    forceReload: true,
                    activate: false
                }).then(function (args) {
                    if (activeNode) {
                        var activeNodePath = treeService.getPath(activeNode).join();
                        //sync to this node now - depending on what was copied this might already be synced but might not be
                        navigationService.syncTree({
                            tree: 'media',
                            path: activeNodePath,
                            forceReload: false,
                            activate: true
                        });
                    }
                });
            }, function (err) {
                $scope.success = false;
                $scope.error = err;
            });
        };
        // Mini list view
        $scope.selectListViewNode = function (node) {
            node.selected = node.selected === true ? false : true;
            nodeSelectHandler({ node: node });
        };
        $scope.closeMiniListView = function () {
            $scope.miniListView = undefined;
        };
        function openMiniListView(node) {
            $scope.miniListView = node;
        }
    });
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Content.MediaRecycleBinController
 * @function
 * 
 * @description
 * Controls the recycle bin for media
 * 
 */
    function MediaRecycleBinController($scope, $routeParams, mediaResource, navigationService, localizationService) {
        //ensures the list view doesn't actually load until we query for the list view config
        // for the section
        $scope.page = {};
        $scope.page.name = 'Recycle Bin';
        $scope.page.nameLocked = true;
        //ensures the list view doesn't actually load until we query for the list view config
        // for the section
        $scope.listViewPath = null;
        $routeParams.id = '-21';
        mediaResource.getRecycleBin().then(function (result) {
            $scope.content = result;
        });
        // sync tree node
        navigationService.syncTree({
            tree: 'media',
            path: [
                '-1',
                $routeParams.id
            ],
            forceReload: false
        });
        localizePageName();
        function localizePageName() {
            var pageName = 'general_recycleBin';
            localizationService.localize(pageName).then(function (value) {
                $scope.page.name = value;
            });
        }
    }
    angular.module('umbraco').controller('Umbraco.Editors.Media.RecycleBinController', MediaRecycleBinController);
    'use strict';
    angular.module('umbraco').controller('Umbraco.Editors.Media.RestoreController', function ($scope, relationResource, mediaResource, navigationService, appState, treeService, localizationService) {
        $scope.source = _.clone($scope.currentNode);
        $scope.error = null;
        $scope.success = false;
        $scope.loading = true;
        relationResource.getByChildId($scope.source.id, 'relateParentDocumentOnDelete').then(function (data) {
            $scope.loading = false;
            if (!data.length) {
                localizationService.localizeMany([
                    'recycleBin_itemCannotBeRestored',
                    'recycleBin_noRestoreRelation'
                ]).then(function (values) {
                    $scope.success = false;
                    $scope.error = {
                        errorMsg: values[0],
                        data: { Message: values[1] }
                    };
                });
                return;
            }
            $scope.relation = data[0];
            if ($scope.relation.parentId === -1) {
                $scope.target = {
                    id: -1,
                    name: 'Root'
                };
            } else {
                $scope.loading = true;
                mediaResource.getById($scope.relation.parentId).then(function (data) {
                    $scope.loading = false;
                    $scope.target = data;
                    // make sure the target item isn't in the recycle bin
                    if ($scope.target.path.indexOf('-21') !== -1) {
                        localizationService.localizeMany([
                            'recycleBin_itemCannotBeRestored',
                            'recycleBin_restoreUnderRecycled'
                        ]).then(function (values) {
                            $scope.success = false;
                            $scope.error = {
                                errorMsg: values[0],
                                data: { Message: values[1].replace('%0%', $scope.target.name) }
                            };
                        });
                        $scope.success = false;
                    }
                }, function (err) {
                    $scope.success = false;
                    $scope.error = err;
                    $scope.loading = false;
                });
            }
        }, function (err) {
            $scope.success = false;
            $scope.error = err;
            $scope.loading = false;
        });
        $scope.restore = function () {
            $scope.loading = true;
            // this code was copied from `content.move.controller.js`
            mediaResource.move({
                parentId: $scope.target.id,
                id: $scope.source.id
            }).then(function (path) {
                $scope.loading = false;
                $scope.success = true;
                //first we need to remove the node that launched the dialog
                treeService.removeNode($scope.currentNode);
                //get the currently edited node (if any)
                var activeNode = appState.getTreeState('selectedNode');
                //we need to do a double sync here: first sync to the moved media item - but don't activate the node,
                //then sync to the currenlty edited media item (note: this might not be the media item that was moved!!)
                navigationService.syncTree({
                    tree: 'media',
                    path: path,
                    forceReload: true,
                    activate: false
                }).then(function (args) {
                    if (activeNode) {
                        var activeNodePath = treeService.getPath(activeNode).join();
                        //sync to this node now - depending on what was copied this might already be synced but might not be
                        navigationService.syncTree({
                            tree: 'media',
                            path: activeNodePath,
                            forceReload: false,
                            activate: true
                        });
                    }
                });
            }, function (err) {
                $scope.success = false;
                $scope.error = err;
                $scope.loading = false;
            });
        };
        $scope.close = function () {
            navigationService.hideDialog();
        };
    });
    'use strict';
    (function () {
        'use strict';
        function MediaSortController($scope, $filter, mediaResource, navigationService) {
            var vm = this;
            var parentId = $scope.currentNode.parentId ? $scope.currentNode.parentId : '-1';
            var id = $scope.currentNode.id;
            vm.loading = false;
            vm.children = [];
            vm.saveButtonState = 'init';
            vm.sortOrder = {};
            vm.sortableOptions = {
                distance: 10,
                tolerance: 'pointer',
                opacity: 0.7,
                scroll: true,
                cursor: 'move',
                helper: fixSortableHelper,
                update: function update() {
                    // clear the sort order when drag and drop is used
                    vm.sortOrder.column = '';
                    vm.sortOrder.reverse = false;
                }
            };
            vm.save = save;
            vm.sort = sort;
            vm.close = close;
            function onInit() {
                vm.loading = true;
                mediaResource.getChildren(id).then(function (data) {
                    vm.children = data.items;
                    vm.loading = false;
                });
            }
            function save() {
                vm.saveButtonState = 'busy';
                var args = {
                    parentId: parentId,
                    sortedIds: _.map(vm.children, function (child) {
                        return child.id;
                    })
                };
                mediaResource.sort(args).then(function () {
                    navigationService.syncTree({
                        tree: 'media',
                        path: $scope.currentNode.path,
                        forceReload: true
                    }).then(function () {
                        return navigationService.reloadNode($scope.currentNode);
                    });
                    vm.saveButtonState = 'success';
                }, function (error) {
                    vm.error = error;
                    vm.saveButtonState = 'error';
                });
            }
            function fixSortableHelper(e, ui) {
                // keep the correct width of each table cell when sorting
                ui.children().each(function () {
                    $(this).width($(this).width());
                });
                return ui;
            }
            function sort(column) {
                // reverse if it is already ordered by that column
                if (vm.sortOrder.column === column) {
                    vm.sortOrder.reverse = !vm.sortOrder.reverse;
                } else {
                    vm.sortOrder.column = column;
                    vm.sortOrder.reverse = false;
                }
                vm.children = $filter('orderBy')(vm.children, vm.sortOrder.column, vm.sortOrder.reverse);
            }
            function close() {
                navigationService.hideDialog();
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Media.SortController', MediaSortController);
    }());
    'use strict';
    angular.module('umbraco').controller('Umbraco.Editors.MediaTypes.CopyController', function ($scope, mediaTypeResource, treeService, navigationService, notificationsService, appState, eventsService) {
        $scope.dialogTreeApi = {};
        $scope.source = _.clone($scope.currentNode);
        function nodeSelectHandler(args) {
            args.event.preventDefault();
            args.event.stopPropagation();
            if ($scope.target) {
                //un-select if there's a current one selected
                $scope.target.selected = false;
            }
            $scope.target = args.node;
            $scope.target.selected = true;
        }
        $scope.copy = function () {
            $scope.busy = true;
            $scope.error = false;
            mediaTypeResource.copy({
                parentId: $scope.target.id,
                id: $scope.source.id
            }).then(function (path) {
                $scope.error = false;
                $scope.success = true;
                $scope.busy = false;
                //get the currently edited node (if any)
                var activeNode = appState.getTreeState('selectedNode');
                //we need to do a double sync here: first sync to the copied content - but don't activate the node,
                //then sync to the currenlty edited content (note: this might not be the content that was copied!!)
                navigationService.syncTree({
                    tree: 'mediaTypes',
                    path: path,
                    forceReload: true,
                    activate: false
                }).then(function (args) {
                    if (activeNode) {
                        var activeNodePath = treeService.getPath(activeNode).join();
                        //sync to this node now - depending on what was copied this might already be synced but might not be
                        navigationService.syncTree({
                            tree: 'mediaTypes',
                            path: activeNodePath,
                            forceReload: false,
                            activate: true
                        });
                    }
                });
            }, function (err) {
                $scope.success = false;
                $scope.error = err;
                $scope.busy = false;
            });
        };
        $scope.onTreeInit = function () {
            $scope.dialogTreeApi.callbacks.treeNodeSelect(nodeSelectHandler);
        };
        $scope.close = function () {
            navigationService.hideDialog();
        };
    });
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.MediaType.CreateController
 * @function
 *
 * @description
 * The controller for the media type creation dialog
 */
    function MediaTypesCreateController($scope, $location, navigationService, mediaTypeResource, formHelper, appState, localizationService) {
        $scope.model = {
            folderName: '',
            creatingFolder: false
        };
        var node = $scope.currentNode;
        $scope.showCreateFolder = function () {
            $scope.model.creatingFolder = true;
        };
        $scope.createContainer = function () {
            if (formHelper.submitForm({
                    scope: $scope,
                    formCtrl: this.createFolderForm
                })) {
                mediaTypeResource.createContainer(node.id, $scope.model.folderName).then(function (folderId) {
                    navigationService.hideMenu();
                    var currPath = node.path ? node.path : '-1';
                    navigationService.syncTree({
                        tree: 'mediatypes',
                        path: currPath + ',' + folderId,
                        forceReload: true,
                        activate: true
                    });
                    formHelper.resetForm({ scope: $scope });
                    var section = appState.getSectionState('currentSection');
                }, function (err) {
                    $scope.error = err;
                });
            }
            ;
        };
        $scope.createMediaType = function () {
            $location.search('create', null);
            $location.path('/settings/mediatypes/edit/' + node.id).search('create', 'true');
            navigationService.hideMenu();
        };
        $scope.close = function () {
            var showMenu = true;
            navigationService.hideDialog(showMenu);
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.MediaTypes.CreateController', MediaTypesCreateController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.MediaType.DeleteController
 * @function
 *
 * @description
 * The controller for the media type delete dialog
 */
    function MediaTypesDeleteController($scope, dataTypeResource, mediaTypeResource, treeService, navigationService) {
        $scope.performDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            mediaTypeResource.deleteById($scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                //TODO: Need to sync tree, etc...
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
            });
        };
        $scope.performContainerDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            mediaTypeResource.deleteContainerById($scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                //TODO: Need to sync tree, etc...
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.MediaTypes.DeleteController', MediaTypesDeleteController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.MediaType.EditController
 * @function
 *
 * @description
 * The controller for the media type editor
 */
    (function () {
        'use strict';
        function MediaTypesEditController($scope, $routeParams, mediaTypeResource, dataTypeResource, editorState, contentEditingHelper, formHelper, navigationService, iconHelper, contentTypeHelper, notificationsService, $filter, $q, localizationService, overlayHelper, eventsService) {
            var vm = this;
            var evts = [];
            var mediaTypeId = $routeParams.id;
            var create = $routeParams.create;
            var infiniteMode = $scope.model && $scope.model.infiniteMode;
            vm.save = save;
            vm.close = close;
            vm.currentNode = null;
            vm.contentType = {};
            vm.page = {};
            vm.page.loading = false;
            vm.page.saveButtonState = 'init';
            vm.labels = {};
            vm.saveButtonKey = 'buttons_save';
            vm.generateModelsKey = 'buttons_saveAndGenerateModels';
            onInit();
            function onInit() {
                // get init values from model when in infinite mode
                if (infiniteMode) {
                    mediaTypeId = $scope.model.id;
                    create = $scope.model.create;
                    vm.saveButtonKey = 'buttons_saveAndClose';
                    vm.generateModelsKey = 'buttons_generateModelsAndClose';
                }
            }
            var labelKeys = [
                'general_design',
                'general_listView',
                'general_rights',
                'main_sections',
                'shortcuts_navigateSections',
                'shortcuts_addTab',
                'shortcuts_addProperty',
                'shortcuts_addEditor',
                'shortcuts_editDataType',
                'shortcuts_toggleListView',
                'shortcuts_toggleAllowAsRoot',
                'shortcuts_addChildNode'
            ];
            localizationService.localizeMany(labelKeys).then(function (values) {
                // navigation
                vm.labels.design = values[0];
                vm.labels.listview = values[1];
                vm.labels.permissions = values[2];
                // keyboard shortcuts
                vm.labels.sections = values[3];
                vm.labels.navigateSections = values[4];
                vm.labels.addTab = values[5];
                vm.labels.addProperty = values[6];
                vm.labels.addEditor = values[7];
                vm.labels.editDataType = values[8];
                vm.labels.toggleListView = values[9];
                vm.labels.allowAsRoot = values[10];
                vm.labels.addChildNode = values[11];
                vm.page.navigation = [
                    {
                        'name': vm.labels.design,
                        'alias': 'design',
                        'icon': 'icon-document-dashed-line',
                        'view': 'views/mediatypes/views/design/design.html',
                        'active': true
                    },
                    {
                        'name': vm.labels.listview,
                        'alias': 'listView',
                        'icon': 'icon-list',
                        'view': 'views/mediatypes/views/listview/listview.html'
                    },
                    {
                        'name': vm.labels.permissions,
                        'alias': 'permissions',
                        'icon': 'icon-keychain',
                        'view': 'views/mediatypes/views/permissions/permissions.html'
                    }
                ];
                vm.page.keyboardShortcutsOverview = [
                    {
                        'name': vm.labels.sections,
                        'shortcuts': [{
                                'description': vm.labels.navigateSections,
                                'keys': [
                                    { 'key': '1' },
                                    { 'key': '3' }
                                ],
                                'keyRange': true
                            }]
                    },
                    {
                        'name': vm.labels.design,
                        'shortcuts': [
                            {
                                'description': vm.labels.addTab,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 't' }
                                ]
                            },
                            {
                                'description': vm.labels.addProperty,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'p' }
                                ]
                            },
                            {
                                'description': vm.labels.addEditor,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'e' }
                                ]
                            },
                            {
                                'description': vm.labels.editDataType,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'd' }
                                ]
                            }
                        ]
                    },
                    {
                        'name': vm.labels.listview,
                        'shortcuts': [{
                                'description': vm.labels.toggleListView,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'l' }
                                ]
                            }]
                    },
                    {
                        'name': vm.labels.permissions,
                        'shortcuts': [
                            {
                                'description': vm.labels.allowAsRoot,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'r' }
                                ]
                            },
                            {
                                'description': vm.labels.addChildNode,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'c' }
                                ]
                            }
                        ]
                    }
                ];
            });
            contentTypeHelper.checkModelsBuilderStatus().then(function (result) {
                vm.page.modelsBuilder = result;
                if (result) {
                    //Models builder mode:
                    vm.page.defaultButton = {
                        hotKey: 'ctrl+s',
                        hotKeyWhenHidden: true,
                        labelKey: vm.saveButtonKey,
                        letter: 'S',
                        type: 'submit',
                        handler: function handler() {
                            vm.save();
                        }
                    };
                    vm.page.subButtons = [{
                            hotKey: 'ctrl+g',
                            hotKeyWhenHidden: true,
                            labelKey: vm.generateModelsKey,
                            letter: 'G',
                            handler: function handler() {
                                vm.page.saveButtonState = 'busy';
                                vm.save().then(function (result) {
                                    vm.page.saveButtonState = 'busy';
                                    localizationService.localize('modelsBuilder_buildingModels').then(function (headerValue) {
                                        localizationService.localize('modelsBuilder_waitingMessage').then(function (msgValue) {
                                            notificationsService.info(headerValue, msgValue);
                                        });
                                    });
                                    contentTypeHelper.generateModels().then(function (result) {
                                        if (!result.lastError) {
                                            //re-check model status
                                            contentTypeHelper.checkModelsBuilderStatus().then(function (statusResult) {
                                                vm.page.modelsBuilder = statusResult;
                                            });
                                            //clear and add success
                                            vm.page.saveButtonState = 'init';
                                            localizationService.localize('modelsBuilder_modelsGenerated').then(function (value) {
                                                notificationsService.success(value);
                                            });
                                        } else {
                                            vm.page.saveButtonState = 'error';
                                            localizationService.localize('modelsBuilder_modelsExceptionInUlog').then(function (value) {
                                                notificationsService.error(value);
                                            });
                                        }
                                    }, function () {
                                        vm.page.saveButtonState = 'error';
                                        localizationService.localize('modelsBuilder_modelsGeneratedError').then(function (value) {
                                            notificationsService.error(value);
                                        });
                                    });
                                });
                            }
                        }];
                }
            });
            if (create) {
                vm.page.loading = true;
                //we are creating so get an empty data type item
                mediaTypeResource.getScaffold(mediaTypeId).then(function (dt) {
                    init(dt);
                    vm.page.loading = false;
                });
            } else {
                loadMediaType();
            }
            function loadMediaType() {
                vm.page.loading = true;
                mediaTypeResource.getById(mediaTypeId).then(function (dt) {
                    init(dt);
                    if (!infiniteMode) {
                        syncTreeNode(vm.contentType, dt.path, true);
                    }
                    vm.page.loading = false;
                });
            }
            /* ---------- SAVE ---------- */
            function save() {
                // only save if there is no overlays open
                if (overlayHelper.getNumberOfOverlays() === 0) {
                    var deferred = $q.defer();
                    vm.page.saveButtonState = 'busy';
                    // reformat allowed content types to array if id's
                    vm.contentType.allowedContentTypes = contentTypeHelper.createIdArray(vm.contentType.allowedContentTypes);
                    contentEditingHelper.contentEditorPerformSave({
                        saveMethod: mediaTypeResource.save,
                        scope: $scope,
                        content: vm.contentType,
                        //We do not redirect on failure for doc types - this is because it is not possible to actually save the doc
                        // type when server side validation fails - as opposed to content where we are capable of saving the content
                        // item if server side validation fails
                        redirectOnFailure: false,
                        // we need to rebind... the IDs that have been created!
                        rebindCallback: function rebindCallback(origContentType, savedContentType) {
                            vm.contentType.id = savedContentType.id;
                            vm.contentType.groups.forEach(function (group) {
                                if (!group.name)
                                    return;
                                var k = 0;
                                while (k < savedContentType.groups.length && savedContentType.groups[k].name != group.name) {
                                    k++;
                                }
                                if (k == savedContentType.groups.length) {
                                    group.id = 0;
                                    return;
                                }
                                var savedGroup = savedContentType.groups[k];
                                if (!group.id)
                                    group.id = savedGroup.id;
                                group.properties.forEach(function (property) {
                                    if (property.id || !property.alias)
                                        return;
                                    k = 0;
                                    while (k < savedGroup.properties.length && savedGroup.properties[k].alias != property.alias) {
                                        k++;
                                    }
                                    if (k == savedGroup.properties.length) {
                                        property.id = 0;
                                        return;
                                    }
                                    var savedProperty = savedGroup.properties[k];
                                    property.id = savedProperty.id;
                                });
                            });
                        }
                    }).then(function (data) {
                        //success
                        if (!infiniteMode) {
                            syncTreeNode(vm.contentType, data.path);
                        }
                        // emit event
                        var args = { mediaType: vm.contentType };
                        eventsService.emit('editors.mediaType.saved', args);
                        vm.page.saveButtonState = 'success';
                        if (infiniteMode && $scope.model.submit) {
                            $scope.model.submit();
                        }
                        deferred.resolve(data);
                    }, function (err) {
                        //error
                        if (err) {
                            editorState.set($scope.content);
                        } else {
                            localizationService.localize('speechBubbles_validationFailedHeader').then(function (headerValue) {
                                localizationService.localize('speechBubbles_validationFailedMessage').then(function (msgValue) {
                                    notificationsService.error(headerValue, msgValue);
                                });
                            });
                        }
                        vm.page.saveButtonState = 'error';
                        deferred.reject(err);
                    });
                    return deferred.promise;
                }
            }
            function init(contentType) {
                // set all tab to inactive
                if (contentType.groups.length !== 0) {
                    angular.forEach(contentType.groups, function (group) {
                        angular.forEach(group.properties, function (property) {
                            // get data type details for each property
                            getDataTypeDetails(property);
                        });
                    });
                }
                // convert icons for content type
                convertLegacyIcons(contentType);
                //set a shared state
                editorState.set(contentType);
                vm.contentType = contentType;
            }
            function convertLegacyIcons(contentType) {
                // make array to store contentType icon
                var contentTypeArray = [];
                // push icon to array
                contentTypeArray.push({ 'icon': contentType.icon });
                // run through icon method
                iconHelper.formatContentTypeIcons(contentTypeArray);
                // set icon back on contentType
                contentType.icon = contentTypeArray[0].icon;
            }
            function getDataTypeDetails(property) {
                if (property.propertyState !== 'init') {
                    dataTypeResource.getById(property.dataTypeId).then(function (dataType) {
                        property.dataTypeIcon = dataType.icon;
                        property.dataTypeName = dataType.name;
                    });
                }
            }
            /** Syncs the content type  to it's tree node - this occurs on first load and after saving */
            function syncTreeNode(dt, path, initialLoad) {
                navigationService.syncTree({
                    tree: 'mediatypes',
                    path: path.split(','),
                    forceReload: initialLoad !== true
                }).then(function (syncArgs) {
                    vm.currentNode = syncArgs.node;
                });
            }
            function close() {
                if (infiniteMode && $scope.model.close) {
                    $scope.model.close();
                }
            }
            evts.push(eventsService.on('app.refreshEditor', function (name, error) {
                loadMediaType();
            }));
            //ensure to unregister from all events!
            $scope.$on('$destroy', function () {
                for (var e in evts) {
                    eventsService.unsubscribe(evts[e]);
                }
            });
        }
        angular.module('umbraco').controller('Umbraco.Editors.MediaTypes.EditController', MediaTypesEditController);
    }());
    'use strict';
    angular.module('umbraco').controller('Umbraco.Editors.MediaTypes.MoveController', function ($scope, mediaTypeResource, treeService, navigationService, notificationsService, appState, eventsService) {
        $scope.dialogTreeApi = {};
        $scope.source = _.clone($scope.currentNode);
        function nodeSelectHandler(args) {
            args.event.preventDefault();
            args.event.stopPropagation();
            if ($scope.target) {
                //un-select if there's a current one selected
                $scope.target.selected = false;
            }
            $scope.target = args.node;
            $scope.target.selected = true;
        }
        $scope.move = function () {
            $scope.busy = true;
            $scope.error = false;
            mediaTypeResource.move({
                parentId: $scope.target.id,
                id: $scope.source.id
            }).then(function (path) {
                $scope.error = false;
                $scope.success = true;
                $scope.busy = false;
                //first we need to remove the node that launched the dialog
                treeService.removeNode($scope.currentNode);
                //get the currently edited node (if any)
                var activeNode = appState.getTreeState('selectedNode');
                //we need to do a double sync here: first sync to the moved content - but don't activate the node,
                //then sync to the currenlty edited content (note: this might not be the content that was moved!!)
                navigationService.syncTree({
                    tree: 'mediaTypes',
                    path: path,
                    forceReload: true,
                    activate: false
                }).then(function (args) {
                    if (activeNode) {
                        var activeNodePath = treeService.getPath(activeNode).join();
                        //sync to this node now - depending on what was copied this might already be synced but might not be
                        navigationService.syncTree({
                            tree: 'mediaTypes',
                            path: activeNodePath,
                            forceReload: false,
                            activate: true
                        });
                    }
                });
                eventsService.emit('app.refreshEditor');
            }, function (err) {
                $scope.success = false;
                $scope.error = err;
                $scope.busy = false;
            });
        };
        $scope.onTreeInit = function () {
            $scope.dialogTreeApi.callbacks.treeNodeSelect(nodeSelectHandler);
        };
        $scope.close = function () {
            navigationService.hideDialog();
        };
    });
    'use strict';
    (function () {
        'use strict';
        function PermissionsController($scope, mediaTypeResource, iconHelper, contentTypeHelper, localizationService, overlayService) {
            /* ----------- SCOPE VARIABLES ----------- */
            var vm = this;
            var childNodeSelectorOverlayTitle = '';
            vm.mediaTypes = [];
            vm.selectedChildren = [];
            vm.addChild = addChild;
            vm.removeChild = removeChild;
            vm.toggle = toggle;
            /* ---------- INIT ---------- */
            init();
            function init() {
                localizationService.localize('contentTypeEditor_chooseChildNode').then(function (value) {
                    childNodeSelectorOverlayTitle = value;
                });
                mediaTypeResource.getAll().then(function (mediaTypes) {
                    vm.mediaTypes = mediaTypes;
                    // convert legacy icons
                    iconHelper.formatContentTypeIcons(vm.mediaTypes);
                    vm.selectedChildren = contentTypeHelper.makeObjectArrayFromId($scope.model.allowedContentTypes, vm.mediaTypes);
                    if ($scope.model.id === 0) {
                        contentTypeHelper.insertChildNodePlaceholder(vm.mediaTypes, $scope.model.name, $scope.model.icon, $scope.model.id);
                    }
                });
            }
            function addChild($event) {
                var childNodeSelectorOverlay = {
                    view: 'itempicker',
                    title: childNodeSelectorOverlayTitle,
                    availableItems: vm.mediaTypes,
                    selectedItems: vm.selectedChildren,
                    position: 'target',
                    event: $event,
                    submit: function submit(model) {
                        vm.selectedChildren.push(model.selectedItem);
                        $scope.model.allowedContentTypes.push(model.selectedItem.id);
                        overlayService.close();
                    },
                    close: function close() {
                        overlayService.close();
                    }
                };
                overlayService.open(childNodeSelectorOverlay);
            }
            function removeChild(selectedChild, index) {
                // remove from vm
                vm.selectedChildren.splice(index, 1);
                // remove from content type model
                var selectedChildIndex = $scope.model.allowedContentTypes.indexOf(selectedChild.id);
                $scope.model.allowedContentTypes.splice(selectedChildIndex, 1);
            }
            /**
     * Toggle the $scope.model.allowAsRoot value to either true or false
     */
            function toggle() {
                if ($scope.model.allowAsRoot) {
                    $scope.model.allowAsRoot = false;
                    return;
                }
                $scope.model.allowAsRoot = true;
            }
        }
        angular.module('umbraco').controller('Umbraco.Editors.MediaType.PermissionsController', PermissionsController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Member.CreateController
 * @function
 * 
 * @description
 * The controller for the member creation dialog
 */
    function memberCreateController($scope, memberTypeResource, iconHelper, navigationService) {
        memberTypeResource.getTypes($scope.currentNode.id).then(function (data) {
            $scope.allowedTypes = iconHelper.formatContentTypeIcons(data);
        });
        $scope.close = function () {
            var showMenu = true;
            navigationService.hideDialog(showMenu);
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.Member.CreateController', memberCreateController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Member.DeleteController
 * @function
 *
 * @description
 * The controller for deleting content
 */
    function MemberDeleteController($scope, memberResource, treeService, navigationService, editorState, $location, $routeParams) {
        $scope.performDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            memberResource.deleteByKey($scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                treeService.removeNode($scope.currentNode);
                //if the current edited item is the same one as we're deleting, we need to navigate elsewhere
                if (editorState.current && editorState.current.key == $scope.currentNode.id) {
                    $location.path('/member/member/list/' + ($routeParams.listName ? $routeParams.listName : 'all-members'));
                }
                navigationService.hideMenu();
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.Member.DeleteController', MemberDeleteController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Member.EditController
 * @function
 *
 * @description
 * The controller for the member editor
 */
    function MemberEditController($scope, $routeParams, $location, $q, $window, appState, memberResource, entityResource, navigationService, notificationsService, angularHelper, serverValidationManager, contentEditingHelper, fileManager, formHelper, umbModelMapper, editorState, umbRequestHelper, $http) {
        //setup scope vars
        $scope.page = {};
        $scope.page.loading = true;
        $scope.page.menu = {};
        $scope.page.menu.currentSection = appState.getSectionState('currentSection');
        $scope.page.menu.currentNode = null;
        //the editors affiliated node
        $scope.page.nameLocked = false;
        $scope.page.listViewPath = null;
        $scope.page.saveButtonState = 'init';
        $scope.page.exportButton = 'init';
        $scope.busy = false;
        $scope.page.listViewPath = $routeParams.page && $routeParams.listName ? '/member/member/list/' + $routeParams.listName + '?page=' + $routeParams.page : null;
        //build a path to sync the tree with
        function buildTreePath(data) {
            return $routeParams.listName ? '-1,' + $routeParams.listName : '-1';
        }
        if ($routeParams.create) {
            //if there is no doc type specified then we are going to assume that
            // we are not using the umbraco membership provider
            if ($routeParams.doctype) {
                //we are creating so get an empty member item
                memberResource.getScaffold($routeParams.doctype).then(function (data) {
                    $scope.content = data;
                    setHeaderNameState($scope.content);
                    editorState.set($scope.content);
                    // set all groups to open
                    angular.forEach($scope.content.tabs, function (group) {
                        group.open = true;
                    });
                    $scope.page.loading = false;
                });
            } else {
                memberResource.getScaffold().then(function (data) {
                    $scope.content = data;
                    setHeaderNameState($scope.content);
                    editorState.set($scope.content);
                    // set all groups to open
                    angular.forEach($scope.content.tabs, function (group) {
                        group.open = true;
                    });
                    $scope.page.loading = false;
                });
            }
        } else {
            //so, we usually refernce all editors with the Int ID, but with members we have
            //a different pattern, adding a route-redirect here to handle this just in case.
            //(isNumber doesnt work here since its seen as a string)
            //The reason this might be an INT is due to the routing used for the member list view
            //but this is now configured to use the key, so this is just a fail safe
            if ($routeParams.id && $routeParams.id.length < 9) {
                entityResource.getById($routeParams.id, 'Member').then(function (entity) {
                    $location.path('/member/member/edit/' + entity.key);
                });
            } else {
                //we are editing so get the content item from the server
                memberResource.getByKey($routeParams.id).then(function (data) {
                    $scope.content = data;
                    setHeaderNameState($scope.content);
                    editorState.set($scope.content);
                    var path = buildTreePath(data);
                    //sync the tree (only for ui purposes)
                    navigationService.syncTree({
                        tree: 'member',
                        path: path.split(',')
                    });
                    //it's the initial load of the editor, we need to get the tree node
                    // from the server so that we can load in the actions menu.
                    umbRequestHelper.resourcePromise($http.get(data.treeNodeUrl), 'Failed to retrieve data for child node ' + data.key).then(function (node) {
                        $scope.page.menu.currentNode = node;
                    });
                    //in one particular special case, after we've created a new item we redirect back to the edit
                    // route but there might be server validation errors in the collection which we need to display
                    // after the redirect, so we will bind all subscriptions which will show the server validation errors
                    // if there are any and then clear them so the collection no longer persists them.
                    serverValidationManager.notifyAndClearAllSubscriptions();
                    $scope.page.loading = false;
                });
            }
        }
        function setHeaderNameState(content) {
            if (content.membershipScenario === 0) {
                $scope.page.nameLocked = true;
            }
        }
        $scope.save = function () {
            if (!$scope.busy && formHelper.submitForm({ scope: $scope })) {
                $scope.busy = true;
                $scope.page.saveButtonState = 'busy';
                memberResource.save($scope.content, $routeParams.create, fileManager.getFiles()).then(function (data) {
                    formHelper.resetForm({ scope: $scope });
                    contentEditingHelper.handleSuccessfulSave({
                        scope: $scope,
                        savedContent: data,
                        //specify a custom id to redirect to since we want to use the GUID
                        redirectId: data.key,
                        rebindCallback: contentEditingHelper.reBindChangedProperties($scope.content, data)
                    });
                    editorState.set($scope.content);
                    $scope.busy = false;
                    $scope.page.saveButtonState = 'success';
                    var path = buildTreePath(data);
                    //sync the tree (only for ui purposes)
                    navigationService.syncTree({
                        tree: 'member',
                        path: path.split(','),
                        forceReload: true
                    });
                }, function (err) {
                    contentEditingHelper.handleSaveError({
                        redirectOnFailure: false,
                        err: err,
                        rebindCallback: contentEditingHelper.reBindChangedProperties($scope.content, err.data)
                    });
                    editorState.set($scope.content);
                    $scope.busy = false;
                    $scope.page.saveButtonState = 'error';
                });
            } else {
                $scope.busy = false;
            }
        };
        $scope.export = function () {
            var memberKey = $scope.content.key;
            memberResource.exportMemberData(memberKey);
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.Member.EditController', MemberEditController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Member.ListController
 * @function
 *
 * @description
 * The controller for the member list view
 */
    function MemberListController($scope, $routeParams, $location, $q, $window, appState, memberResource, entityResource, navigationService, notificationsService, angularHelper, serverValidationManager, contentEditingHelper, fileManager, formHelper, umbModelMapper, editorState, localizationService) {
        //setup scope vars
        $scope.currentSection = appState.getSectionState('currentSection');
        $scope.currentNode = null;
        //the editors affiliated node
        $scope.page = {};
        $scope.page.lockedName = true;
        $scope.page.loading = true;
        //we are editing so get the content item from the server
        memberResource.getListNode($routeParams.id).then(function (data) {
            $scope.content = data;
            //translate "All Members"
            if ($scope.content != null && $scope.content.name != null && $scope.content.name.replace(' ', '').toLowerCase() == 'allmembers') {
                localizationService.localize('member_allMembers').then(function (value) {
                    $scope.content.name = value;
                });
            }
            editorState.set($scope.content);
            navigationService.syncTree({
                tree: 'member',
                path: data.path.split(',')
            }).then(function (syncArgs) {
                $scope.currentNode = syncArgs.node;
            });
            //in one particular special case, after we've created a new item we redirect back to the edit
            // route but there might be server validation errors in the collection which we need to display
            // after the redirect, so we will bind all subscriptions which will show the server validation errors
            // if there are any and then clear them so the collection no longer persists them.
            serverValidationManager.notifyAndClearAllSubscriptions();
            $scope.page.loading = false;
        });
    }
    angular.module('umbraco').controller('Umbraco.Editors.Member.ListController', MemberListController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.MemberGroups.DeleteController
 * @function
 *
 * @description
 * The controller for deleting member groups
 */
    function MemberGroupsDeleteController($scope, memberGroupResource, treeService, navigationService) {
        $scope.performDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            memberGroupResource.deleteById($scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                //TODO: Need to sync tree, etc...
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.MemberGroups.DeleteController', MemberGroupsDeleteController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.MemberGroups.EditController
 * @function
 *
 * @description
 * The controller for the member group editor
 */
    function MemberGroupsEditController($scope, $routeParams, appState, navigationService, memberGroupResource, contentEditingHelper, formHelper, editorState, eventsService) {
        //setup scope vars
        $scope.page = {};
        $scope.page.loading = false;
        $scope.page.menu = {};
        $scope.page.menu.currentSection = appState.getSectionState('currentSection');
        $scope.page.menu.currentNode = null;
        var evts = [];
        if ($routeParams.create) {
            $scope.page.loading = true;
            //we are creating so get an empty member group item
            memberGroupResource.getScaffold().then(function (data) {
                $scope.content = data;
                //set a shared state
                editorState.set($scope.content);
                $scope.page.loading = false;
            });
        } else {
            loadMemberGroup();
        }
        function loadMemberGroup() {
            $scope.page.loading = true;
            //we are editing so get the content item from the server
            memberGroupResource.getById($routeParams.id).then(function (data) {
                $scope.content = data;
                //share state
                editorState.set($scope.content);
                navigationService.syncTree({
                    tree: 'memberGroups',
                    path: data.path
                }).then(function (syncArgs) {
                    $scope.page.menu.currentNode = syncArgs.node;
                });
                $scope.page.loading = false;
            });
        }
        $scope.save = function () {
            if (formHelper.submitForm({ scope: $scope })) {
                $scope.page.saveButtonState = 'busy';
                memberGroupResource.save($scope.content, $scope.preValues, $routeParams.create).then(function (data) {
                    formHelper.resetForm({ scope: $scope });
                    contentEditingHelper.handleSuccessfulSave({
                        scope: $scope,
                        savedContent: data
                    });
                    //share state
                    editorState.set($scope.content);
                    navigationService.syncTree({
                        tree: 'memberGroups',
                        path: data.path,
                        forceReload: true
                    }).then(function (syncArgs) {
                        $scope.page.menu.currentNode = syncArgs.node;
                    });
                    $scope.page.saveButtonState = 'success';
                }, function (err) {
                    contentEditingHelper.handleSaveError({
                        redirectOnFailure: false,
                        err: err
                    });
                    $scope.page.saveButtonState = 'error';
                    //share state
                    editorState.set($scope.content);
                });
            }
        };
        evts.push(eventsService.on('app.refreshEditor', function (name, error) {
            loadMemberGroup();
        }));
        //ensure to unregister from all events!
        $scope.$on('$destroy', function () {
            for (var e in evts) {
                eventsService.unsubscribe(evts[e]);
            }
        });
    }
    angular.module('umbraco').controller('Umbraco.Editors.MemberGroups.EditController', MemberGroupsEditController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.MemberTypes.CreateController
 * @function
 *
 * @description
 * The controller for the member type creation dialog
 */
    function MemberTypesCreateController($scope, $location, navigationService, memberTypeResource, formHelper, appState, localizationService) {
        $scope.model = {
            folderName: '',
            creatingFolder: false
        };
        var node = $scope.currentNode;
        var section = appState.getSectionState('currentSection');
        $scope.showCreateFolder = function () {
            $scope.model.creatingFolder = true;
        };
        $scope.createContainer = function () {
            if (formHelper.submitForm({
                    scope: $scope,
                    formCtrl: this.createFolderForm
                })) {
                memberTypeResource.createContainer(node.id, $scope.model.folderName).then(function (folderId) {
                    navigationService.hideMenu();
                    var currPath = node.path ? node.path : '-1';
                    navigationService.syncTree({
                        tree: 'membertypes',
                        path: currPath + ',' + folderId,
                        forceReload: true,
                        activate: true
                    });
                    formHelper.resetForm({ scope: $scope });
                }, function (err) {
                });
            }
            ;
        };
        $scope.createMemberType = function () {
            $location.search('create', null);
            $location.path('/' + section + '/membertypes/edit/' + node.id).search('create', 'true');
            navigationService.hideMenu();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.MemberTypes.CreateController', MemberTypesCreateController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.MemberTypes.DeleteController
 * @function
 *
 * @description
 * The controller for deleting member types
 */
    function MemberTypesDeleteController($scope, memberTypeResource, treeService, navigationService) {
        $scope.performDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            memberTypeResource.deleteById($scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                //TODO: Need to sync tree, etc...
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.MemberTypes.DeleteController', MemberTypesDeleteController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.MemberTypes.EditController
 * @function
 *
 * @description
 * The controller for the member type editor
 */
    (function () {
        'use strict';
        function MemberTypesEditController($scope, $rootScope, $routeParams, $log, $filter, memberTypeResource, dataTypeResource, editorState, iconHelper, formHelper, navigationService, contentEditingHelper, notificationsService, $q, localizationService, overlayHelper, contentTypeHelper) {
            var vm = this;
            vm.save = save;
            vm.currentNode = null;
            vm.contentType = {};
            vm.page = {};
            vm.page.loading = false;
            vm.page.saveButtonState = 'init';
            vm.labels = {};
            var labelKeys = [
                'general_design',
                'shortcuts_shortcut',
                'shortcuts_addTab',
                'shortcuts_addProperty',
                'shortcuts_addEditor',
                'shortcuts_editDataType'
            ];
            localizationService.localizeMany(labelKeys).then(function (values) {
                vm.labels.design = values[0];
                vm.labels.shortcut = values[1];
                vm.labels.addTab = values[2];
                vm.labels.addProperty = values[3];
                vm.labels.addEditor = values[4];
                vm.labels.editDataType = values[5];
                vm.page.navigation = [{
                        'name': vm.labels.design,
                        'icon': 'icon-document-dashed-line',
                        'view': 'views/membertypes/views/design/design.html',
                        'active': true
                    }];
                vm.page.keyboardShortcutsOverview = [{
                        'name': vm.labels.shortcut,
                        'shortcuts': [
                            {
                                'description': vm.labels.addTab,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 't' }
                                ]
                            },
                            {
                                'description': vm.labels.addProperty,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'p' }
                                ]
                            },
                            {
                                'description': vm.labels.addEditor,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'e' }
                                ]
                            },
                            {
                                'description': vm.labels.editDataType,
                                'keys': [
                                    { 'key': 'alt' },
                                    { 'key': 'shift' },
                                    { 'key': 'd' }
                                ]
                            }
                        ]
                    }];
            });
            contentTypeHelper.checkModelsBuilderStatus().then(function (result) {
                vm.page.modelsBuilder = result;
                if (result) {
                    //Models builder mode:
                    vm.page.defaultButton = {
                        hotKey: 'ctrl+s',
                        hotKeyWhenHidden: true,
                        labelKey: 'buttons_save',
                        letter: 'S',
                        type: 'submit',
                        handler: function handler() {
                            vm.save();
                        }
                    };
                    vm.page.subButtons = [{
                            hotKey: 'ctrl+g',
                            hotKeyWhenHidden: true,
                            labelKey: 'buttons_saveAndGenerateModels',
                            letter: 'G',
                            handler: function handler() {
                                vm.page.saveButtonState = 'busy';
                                vm.save().then(function (result) {
                                    vm.page.saveButtonState = 'busy';
                                    localizationService.localize('modelsBuilder_buildingModels').then(function (headerValue) {
                                        localizationService.localize('modelsBuilder_waitingMessage').then(function (msgValue) {
                                            notificationsService.info(headerValue, msgValue);
                                        });
                                    });
                                    contentTypeHelper.generateModels().then(function (result) {
                                        if (!result.lastError) {
                                            //re-check model status
                                            contentTypeHelper.checkModelsBuilderStatus().then(function (statusResult) {
                                                vm.page.modelsBuilder = statusResult;
                                            });
                                            //clear and add success
                                            vm.page.saveButtonState = 'init';
                                            localizationService.localize('modelsBuilder_modelsGenerated').then(function (value) {
                                                notificationsService.success(value);
                                            });
                                        } else {
                                            vm.page.saveButtonState = 'error';
                                            localizationService.localize('modelsBuilder_modelsExceptionInUlog').then(function (value) {
                                                notificationsService.error(value);
                                            });
                                        }
                                    }, function () {
                                        vm.page.saveButtonState = 'error';
                                        localizationService.localize('modelsBuilder_modelsGeneratedError').then(function (value) {
                                            notificationsService.error(value);
                                        });
                                    });
                                });
                            }
                        }];
                }
            });
            if ($routeParams.create) {
                vm.page.loading = true;
                //we are creating so get an empty data type item
                memberTypeResource.getScaffold($routeParams.id).then(function (dt) {
                    init(dt);
                    vm.page.loading = false;
                });
            } else {
                vm.page.loading = true;
                memberTypeResource.getById($routeParams.id).then(function (dt) {
                    init(dt);
                    syncTreeNode(vm.contentType, dt.path, true);
                    vm.page.loading = false;
                });
            }
            function save() {
                // only save if there is no overlays open
                if (overlayHelper.getNumberOfOverlays() === 0) {
                    var deferred = $q.defer();
                    vm.page.saveButtonState = 'busy';
                    contentEditingHelper.contentEditorPerformSave({
                        saveMethod: memberTypeResource.save,
                        scope: $scope,
                        content: vm.contentType,
                        //We do not redirect on failure for doc types - this is because it is not possible to actually save the doc
                        // type when server side validation fails - as opposed to content where we are capable of saving the content
                        // item if server side validation fails
                        redirectOnFailure: false,
                        // we need to rebind... the IDs that have been created!
                        rebindCallback: function rebindCallback(origContentType, savedContentType) {
                            vm.contentType.id = savedContentType.id;
                            vm.contentType.groups.forEach(function (group) {
                                if (!group.name)
                                    return;
                                var k = 0;
                                while (k < savedContentType.groups.length && savedContentType.groups[k].name != group.name) {
                                    k++;
                                }
                                if (k == savedContentType.groups.length) {
                                    group.id = 0;
                                    return;
                                }
                                var savedGroup = savedContentType.groups[k];
                                if (!group.id)
                                    group.id = savedGroup.id;
                                group.properties.forEach(function (property) {
                                    if (property.id || !property.alias)
                                        return;
                                    k = 0;
                                    while (k < savedGroup.properties.length && savedGroup.properties[k].alias != property.alias) {
                                        k++;
                                    }
                                    if (k == savedGroup.properties.length) {
                                        property.id = 0;
                                        return;
                                    }
                                    var savedProperty = savedGroup.properties[k];
                                    property.id = savedProperty.id;
                                });
                            });
                        }
                    }).then(function (data) {
                        //success
                        syncTreeNode(vm.contentType, data.path);
                        vm.page.saveButtonState = 'success';
                        deferred.resolve(data);
                    }, function (err) {
                        //error
                        if (err) {
                            editorState.set($scope.content);
                        } else {
                            localizationService.localize('speechBubbles_validationFailedHeader').then(function (headerValue) {
                                localizationService.localize('speechBubbles_validationFailedMessage').then(function (msgValue) {
                                    notificationsService.error(headerValue, msgValue);
                                });
                            });
                        }
                        vm.page.saveButtonState = 'error';
                        deferred.reject(err);
                    });
                    return deferred.promise;
                }
            }
            function init(contentType) {
                // set all tab to inactive
                if (contentType.groups.length !== 0) {
                    angular.forEach(contentType.groups, function (group) {
                        angular.forEach(group.properties, function (property) {
                            // get data type details for each property
                            getDataTypeDetails(property);
                        });
                    });
                }
                // convert legacy icons
                convertLegacyIcons(contentType);
                //set a shared state
                editorState.set(contentType);
                vm.contentType = contentType;
            }
            function convertLegacyIcons(contentType) {
                // make array to store contentType icon
                var contentTypeArray = [];
                // push icon to array
                contentTypeArray.push({ 'icon': contentType.icon });
                // run through icon method
                iconHelper.formatContentTypeIcons(contentTypeArray);
                // set icon back on contentType
                contentType.icon = contentTypeArray[0].icon;
            }
            function getDataTypeDetails(property) {
                if (property.propertyState !== 'init') {
                    dataTypeResource.getById(property.dataTypeId).then(function (dataType) {
                        property.dataTypeIcon = dataType.icon;
                        property.dataTypeName = dataType.name;
                    });
                }
            }
            /** Syncs the content type  to it's tree node - this occurs on first load and after saving */
            function syncTreeNode(dt, path, initialLoad) {
                navigationService.syncTree({
                    tree: 'membertypes',
                    path: path.split(','),
                    forceReload: initialLoad !== true
                }).then(function (syncArgs) {
                    vm.currentNode = syncArgs.node;
                });
            }
        }
        angular.module('umbraco').controller('Umbraco.Editors.MemberTypes.EditController', MemberTypesEditController);
    }());
    'use strict';
    angular.module('umbraco').controller('Umbraco.Editors.MemberTypes.MoveController', function ($scope) {
    });
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Packages.DeleteController
 * @function
 *
 * @description
 * The controller for deleting content
 */
    function PackageDeleteController($scope, packageResource, treeService, navigationService) {
        $scope.performDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            packageResource.deleteCreatedPackage($scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.Packages.DeleteController', PackageDeleteController);
    'use strict';
    (function () {
        'use strict';
        function PackagesOverviewController($scope, $route, $location, navigationService, $timeout, localStorageService) {
            //Hack!
            // if there is a cookie value for packageInstallUri then we need to redirect there,
            // the issue is that we still have webforms and we cannot go to a hash location and then window.reload
            // because it will double load it.
            // we will refresh and then navigate there.
            var installPackageUri = localStorageService.get('packageInstallUri');
            if (installPackageUri) {
                localStorageService.remove('packageInstallUri');
            }
            if (installPackageUri && installPackageUri !== 'installed') {
                //navigate to the custom installer screen, if it is just "installed", then we'll 
                //show the installed view
                $location.path(installPackageUri).search('');
            } else {
                var vm = this;
                vm.page = {};
                vm.page.name = 'Packages';
                vm.page.navigation = [
                    {
                        'name': 'Packages',
                        'icon': 'icon-cloud',
                        'view': 'views/packages/views/repo.html',
                        'active': !installPackageUri || installPackageUri === 'navigation',
                        'alias': 'umbPackages'
                    },
                    {
                        'name': 'Installed',
                        'icon': 'icon-box',
                        'view': 'views/packages/views/installed.html',
                        'active': installPackageUri === 'installed',
                        'alias': 'umbInstalled'
                    },
                    {
                        'name': 'Install local',
                        'icon': 'icon-add',
                        'view': 'views/packages/views/install-local.html',
                        'active': installPackageUri === 'local',
                        'alias': 'umbInstallLocal'
                    }
                ];
                $timeout(function () {
                    navigationService.syncTree({
                        tree: 'packages',
                        path: '-1'
                    });
                });
            }
        }
        angular.module('umbraco').controller('Umbraco.Editors.Packages.OverviewController', PackagesOverviewController);
    }());
    'use strict';
    (function () {
        'use strict';
        function PackagesInstallLocalController($scope, $route, $location, Upload, umbRequestHelper, packageResource, localStorageService, $timeout, $window, localizationService, $q) {
            var vm = this;
            vm.state = 'upload';
            vm.localPackage = {};
            vm.installPackage = installPackage;
            vm.installState = {
                status: '',
                progress: 0
            };
            vm.installCompleted = false;
            vm.zipFile = {
                uploadStatus: 'idle',
                uploadProgress: 0,
                serverErrorMessage: null
            };
            $scope.handleFiles = function (files, event) {
                if (files) {
                    for (var i = 0; i < files.length; i++) {
                        upload(files[i]);
                    }
                }
            };
            function upload(file) {
                Upload.upload({
                    url: umbRequestHelper.getApiUrl('packageInstallApiBaseUrl', 'UploadLocalPackage'),
                    fields: {},
                    file: file
                }).progress(function (evt) {
                    // hack: in some browsers the progress event is called after success
                    // this prevents the UI from going back to a uploading state
                    if (vm.zipFile.uploadStatus !== 'done' && vm.zipFile.uploadStatus !== 'error') {
                        // set view state to uploading
                        vm.state = 'uploading';
                        // calculate progress in percentage
                        var progressPercentage = parseInt(100 * evt.loaded / evt.total, 10);
                        // set percentage property on file
                        vm.zipFile.uploadProgress = progressPercentage;
                        // set uploading status on file
                        vm.zipFile.uploadStatus = 'uploading';
                    }
                }).success(function (data, status, headers, config) {
                    if (data.notifications && data.notifications.length > 0) {
                        // set error status on file
                        vm.zipFile.uploadStatus = 'error';
                        // Throw message back to user with the cause of the error
                        vm.zipFile.serverErrorMessage = data.notifications[0].message;
                    } else {
                        // set done status on file
                        vm.zipFile.uploadStatus = 'done';
                        loadPackage();
                        vm.zipFile.uploadProgress = 100;
                        vm.localPackage = data;
                    }
                }).error(function (evt, status, headers, config) {
                    // set status done
                    vm.zipFile.uploadStatus = 'error';
                    // If file not found, server will return a 404 and display this message
                    if (status === 404) {
                        vm.zipFile.serverErrorMessage = 'File not found';
                    } else if (status == 400) {
                        //it's a validation error
                        vm.zipFile.serverErrorMessage = evt.message;
                    } else {
                        //it's an unhandled error
                        //if the service returns a detailed error
                        if (evt.InnerException) {
                            vm.zipFile.serverErrorMessage = evt.InnerException.ExceptionMessage;
                            //Check if its the common "too large file" exception
                            if (evt.InnerException.StackTrace && evt.InnerException.StackTrace.indexOf('ValidateRequestEntityLength') > 0) {
                                vm.zipFile.serverErrorMessage = 'File too large to upload';
                            }
                        } else if (evt.Message) {
                            vm.zipFile.serverErrorMessage = evt.Message;
                        }
                    }
                });
            }
            function loadPackage() {
                if (vm.zipFile.uploadStatus === 'done') {
                    vm.state = 'packageDetails';
                }
            }
            function installPackage() {
                vm.installState.status = localizationService.localize('packager_installStateImporting');
                vm.installState.progress = '0';
                packageResource.import(vm.localPackage).then(function (pack) {
                    vm.installState.progress = '25';
                    vm.installState.status = localizationService.localize('packager_installStateInstalling');
                    return packageResource.installFiles(pack);
                }, installError).then(function (pack) {
                    vm.installState.status = localizationService.localize('packager_installStateRestarting');
                    vm.installState.progress = '50';
                    var deferred = $q.defer();
                    //check if the app domain is restarted ever 2 seconds
                    var count = 0;
                    function checkRestart() {
                        $timeout(function () {
                            packageResource.checkRestart(pack).then(function (d) {
                                count++;
                                //if there is an id it means it's not restarted yet but we'll limit it to only check 10 times
                                if (d.isRestarting && count < 10) {
                                    checkRestart();
                                } else {
                                    //it's restarted!
                                    deferred.resolve(d);
                                }
                            }, installError);
                        }, 2000);
                    }
                    checkRestart();
                    return deferred.promise;
                }, installError).then(function (pack) {
                    vm.installState.status = localizationService.localize('packager_installStateRestarting');
                    vm.installState.progress = '75';
                    return packageResource.installData(pack);
                }, installError).then(function (pack) {
                    vm.installState.status = localizationService.localize('packager_installStateComplete');
                    vm.installState.progress = '100';
                    return packageResource.cleanUp(pack);
                }, installError).then(function (result) {
                    if (result.postInstallationPath) {
                        //Put the redirect Uri in a cookie so we can use after reloading
                        localStorageService.set('packageInstallUri', result.postInstallationPath);
                    } else {
                        //set to a constant value so it knows to just go to the installed view
                        localStorageService.set('packageInstallUri', 'installed');
                    }
                    vm.installState.status = localizationService.localize('packager_installStateCompleted');
                    vm.installCompleted = true;
                }, installError);
            }
            function installError() {
                //This will return a rejection meaning that the promise change above will stop
                return $q.reject();
            }
            vm.reloadPage = function () {
                //reload on next digest (after cookie)
                $timeout(function () {
                    $window.location.reload(true);
                });
            };
        }
        angular.module('umbraco').controller('Umbraco.Editors.Packages.InstallLocalController', PackagesInstallLocalController);
    }());
    'use strict';
    (function () {
        'use strict';
        function PackagesInstalledController($scope, $route, $location, packageResource, $timeout, $window, localStorageService, localizationService) {
            var vm = this;
            vm.confirmUninstall = confirmUninstall;
            vm.uninstallPackage = uninstallPackage;
            vm.state = 'list';
            vm.installState = { status: '' };
            vm.package = {};
            function init() {
                packageResource.getInstalled().then(function (packs) {
                    vm.installedPackages = packs;
                });
                vm.installState.status = '';
                vm.state = 'list';
            }
            function confirmUninstall(pck) {
                vm.state = 'packageDetails';
                vm.package = pck;
            }
            function uninstallPackage(installedPackage) {
                vm.installState.status = localizationService.localize('packager_installStateUninstalling');
                vm.installState.progress = '0';
                packageResource.uninstall(installedPackage.id).then(function () {
                    if (installedPackage.files.length > 0) {
                        vm.installState.status = localizationService.localize('packager_installStateComplete');
                        vm.installState.progress = '100';
                        //set this flag so that on refresh it shows the installed packages list
                        localStorageService.set('packageInstallUri', 'installed');
                        //reload on next digest (after cookie)
                        $timeout(function () {
                            $window.location.reload(true);
                        });
                    } else {
                        init();
                    }
                });
            }
            init();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Packages.InstalledController', PackagesInstalledController);
    }());
    'use strict';
    (function () {
        'use strict';
        function PackagesRepoController($scope, $route, $location, $timeout, ourPackageRepositoryResource, $q, packageResource, localStorageService, localizationService) {
            var vm = this;
            vm.packageViewState = 'packageList';
            vm.categories = [];
            vm.loading = true;
            vm.pagination = {
                pageNumber: 1,
                totalPages: 10,
                pageSize: 24
            };
            vm.searchQuery = '';
            vm.installState = {
                status: '',
                progress: 0,
                type: 'ok'
            };
            vm.selectCategory = selectCategory;
            vm.showPackageDetails = showPackageDetails;
            vm.setPackageViewState = setPackageViewState;
            vm.nextPage = nextPage;
            vm.prevPage = prevPage;
            vm.goToPage = goToPage;
            vm.installPackage = installPackage;
            vm.downloadPackage = downloadPackage;
            vm.openLightbox = openLightbox;
            vm.closeLightbox = closeLightbox;
            vm.search = search;
            vm.installCompleted = false;
            var currSort = 'Latest';
            //used to cancel any request in progress if another one needs to take it's place
            var canceler = null;
            function getActiveCategory() {
                if (vm.searchQuery !== '') {
                    return '';
                }
                for (var i = 0; i < vm.categories.length; i++) {
                    if (vm.categories[i].active === true) {
                        return vm.categories[i].name;
                    }
                }
                return '';
            }
            function init() {
                vm.loading = true;
                $q.all([
                    ourPackageRepositoryResource.getCategories().then(function (cats) {
                        vm.categories = cats;
                    }),
                    ourPackageRepositoryResource.getPopular(8).then(function (pack) {
                        vm.popular = pack.packages;
                    }),
                    ourPackageRepositoryResource.search(vm.pagination.pageNumber - 1, vm.pagination.pageSize, currSort).then(function (pack) {
                        vm.packages = pack.packages;
                        vm.pagination.totalPages = Math.ceil(pack.total / vm.pagination.pageSize);
                    })
                ]).then(function () {
                    vm.loading = false;
                });
            }
            function selectCategory(selectedCategory, categories) {
                var reset = false;
                for (var i = 0; i < categories.length; i++) {
                    var category = categories[i];
                    if (category.name === selectedCategory.name && category.active === true) {
                        //it's already selected, let's unselect to show all again
                        reset = true;
                    }
                    category.active = false;
                }
                vm.loading = true;
                vm.searchQuery = '';
                var searchCategory = selectedCategory.name;
                if (reset === true) {
                    searchCategory = '';
                }
                currSort = 'Latest';
                $q.all([
                    ourPackageRepositoryResource.getPopular(8, searchCategory).then(function (pack) {
                        vm.popular = pack.packages;
                    }),
                    ourPackageRepositoryResource.search(vm.pagination.pageNumber - 1, vm.pagination.pageSize, currSort, searchCategory, vm.searchQuery).then(function (pack) {
                        vm.packages = pack.packages;
                        vm.pagination.totalPages = Math.ceil(pack.total / vm.pagination.pageSize);
                        vm.pagination.pageNumber = 1;
                    })
                ]).then(function () {
                    vm.loading = false;
                    selectedCategory.active = reset === false;
                });
            }
            function showPackageDetails(selectedPackage) {
                ourPackageRepositoryResource.getDetails(selectedPackage.id).then(function (pack) {
                    packageResource.validateInstalled(pack.name, pack.latestVersion).then(function () {
                        //ok, can install
                        vm.package = pack;
                        vm.package.isValid = true;
                        vm.packageViewState = 'packageDetails';
                    }, function () {
                        //nope, cannot install
                        vm.package = pack;
                        vm.package.isValid = false;
                        vm.packageViewState = 'packageDetails';
                    });
                });
            }
            function setPackageViewState(state) {
                if (state) {
                    vm.packageViewState = state;
                }
            }
            function nextPage(pageNumber) {
                ourPackageRepositoryResource.search(pageNumber - 1, vm.pagination.pageSize, currSort, getActiveCategory(), vm.searchQuery).then(function (pack) {
                    vm.packages = pack.packages;
                    vm.pagination.totalPages = Math.ceil(pack.total / vm.pagination.pageSize);
                });
            }
            function prevPage(pageNumber) {
                ourPackageRepositoryResource.search(pageNumber - 1, vm.pagination.pageSize, currSort, getActiveCategory(), vm.searchQuery).then(function (pack) {
                    vm.packages = pack.packages;
                    vm.pagination.totalPages = Math.ceil(pack.total / vm.pagination.pageSize);
                });
            }
            function goToPage(pageNumber) {
                ourPackageRepositoryResource.search(pageNumber - 1, vm.pagination.pageSize, currSort, getActiveCategory(), vm.searchQuery).then(function (pack) {
                    vm.packages = pack.packages;
                    vm.pagination.totalPages = Math.ceil(pack.total / vm.pagination.pageSize);
                });
            }
            function downloadPackage(selectedPackage) {
                vm.loading = true;
                packageResource.fetch(selectedPackage.id).then(function (pack) {
                    vm.packageViewState = 'packageInstall';
                    vm.loading = false;
                    vm.localPackage = pack;
                    vm.localPackage.allowed = true;
                }, function (evt, status, headers, config) {
                    if (status == 400) {
                        //it's a validation error
                        vm.installState.type = 'error';
                        vm.zipFile.serverErrorMessage = evt.message;
                    }
                });
            }
            function error(e, args) {
                //This will return a rejection meaning that the promise change above will stop
                return $q.reject();
            }
            function installPackage(selectedPackage) {
                vm.installState.status = localizationService.localize('packager_installStateImporting');
                vm.installState.progress = '0';
                packageResource.import(selectedPackage).then(function (pack) {
                    vm.installState.status = localizationService.localize('packager_installStateInstalling');
                    vm.installState.progress = '25';
                    return packageResource.installFiles(pack);
                }, error).then(function (pack) {
                    vm.installState.status = localizationService.localize('packager_installStateRestarting');
                    vm.installState.progress = '50';
                    var deferred = $q.defer();
                    //check if the app domain is restarted ever 2 seconds
                    var count = 0;
                    function checkRestart() {
                        $timeout(function () {
                            packageResource.checkRestart(pack).then(function (d) {
                                count++;
                                //if there is an id it means it's not restarted yet but we'll limit it to only check 10 times
                                if (d.isRestarting && count < 10) {
                                    checkRestart();
                                } else {
                                    //it's restarted!
                                    deferred.resolve(d);
                                }
                            }, error);
                        }, 2000);
                    }
                    checkRestart();
                    return deferred.promise;
                }, error).then(function (pack) {
                    vm.installState.status = localizationService.localize('packager_installStateRestarting');
                    vm.installState.progress = '75';
                    return packageResource.installData(pack);
                }, error).then(function (pack) {
                    vm.installState.status = localizationService.localize('packager_installStateComplete');
                    vm.installState.progress = '100';
                    return packageResource.cleanUp(pack);
                }, error).then(function (result) {
                    if (result.postInstallationPath) {
                        //Put the redirect Uri in a cookie so we can use after reloading
                        localStorageService.set('packageInstallUri', result.postInstallationPath);
                    }
                    vm.installState.status = localizationService.localize('packager_installStateCompleted');
                    vm.installCompleted = true;
                }, error);
            }
            function openLightbox(itemIndex, items) {
                vm.lightbox = {
                    show: true,
                    items: items,
                    activeIndex: itemIndex
                };
            }
            function closeLightbox() {
                vm.lightbox.show = false;
                vm.lightbox = null;
            }
            var searchDebounced = _.debounce(function (e) {
                $scope.$apply(function () {
                    //a canceler exists, so perform the cancelation operation and reset
                    if (canceler) {
                        canceler.resolve();
                        canceler = $q.defer();
                    } else {
                        canceler = $q.defer();
                    }
                    currSort = vm.searchQuery ? 'Default' : 'Latest';
                    ourPackageRepositoryResource.search(vm.pagination.pageNumber - 1, vm.pagination.pageSize, currSort, '', vm.searchQuery, canceler).then(function (pack) {
                        vm.packages = pack.packages;
                        vm.pagination.totalPages = Math.ceil(pack.total / vm.pagination.pageSize);
                        vm.pagination.pageNumber = 1;
                        vm.loading = false;
                        //set back to null so it can be re-created
                        canceler = null;
                    });
                });
            }, 200);
            function search(searchQuery) {
                vm.loading = true;
                searchDebounced();
            }
            vm.reloadPage = function () {
                //reload on next digest (after cookie)
                $timeout(function () {
                    window.location.reload(true);
                });
            };
            init();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Packages.RepoController', PackagesRepoController);
    }());
    'use strict';
    (function () {
        'use strict';
        function PartialViewMacrosCreateController($scope, codefileResource, $location, navigationService, formHelper, appState) {
            var vm = this;
            var node = $scope.currentNode;
            vm.snippets = [];
            vm.createFolderError = '';
            vm.folderName = '';
            vm.fileName = '';
            vm.showSnippets = false;
            vm.creatingFolder = false;
            vm.showCreateFolder = showCreateFolder;
            vm.createFolder = createFolder;
            vm.createFile = createFile;
            vm.createFileWithoutMacro = createFileWithoutMacro;
            vm.showCreateFromSnippet = showCreateFromSnippet;
            vm.createFileFromSnippet = createFileFromSnippet;
            vm.close = close;
            function onInit() {
                codefileResource.getSnippets('partialViewMacros').then(function (snippets) {
                    vm.snippets = snippets;
                });
            }
            function showCreateFolder() {
                vm.creatingFolder = true;
            }
            function createFolder(form) {
                if (formHelper.submitForm({
                        scope: $scope,
                        formCtrl: form
                    })) {
                    codefileResource.createContainer('partialViewMacros', node.id, vm.folderName).then(function (saved) {
                        navigationService.hideMenu();
                        navigationService.syncTree({
                            tree: 'partialViewMacros',
                            path: saved.path,
                            forceReload: true,
                            activate: true
                        });
                        formHelper.resetForm({ scope: $scope });
                        var section = appState.getSectionState('currentSection');
                    }, function (err) {
                        vm.createFolderError = err;
                    });
                }
            }
            function createFile() {
                $location.path('/settings/partialviewmacros/edit/' + node.id).search('create', 'true');
                navigationService.hideMenu();
            }
            function createFileWithoutMacro() {
                $location.path('/settings/partialviewmacros/edit/' + node.id).search('create', 'true').search('nomacro', 'true');
                navigationService.hideMenu();
            }
            function createFileFromSnippet(snippet) {
                $location.path('/settings/partialviewmacros/edit/' + node.id).search('create', 'true').search('snippet', snippet.fileName);
                navigationService.hideMenu();
            }
            function showCreateFromSnippet() {
                vm.showSnippets = true;
            }
            function close() {
                var showMenu = true;
                navigationService.hideDialog(showMenu);
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.PartialViewMacros.CreateController', PartialViewMacrosCreateController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.PartialViewMacros.DeleteController
 * @function
 *
 * @description
 * The controller for deleting partial view macros
 */
    function PartialViewMacrosDeleteController($scope, codefileResource, treeService, navigationService) {
        $scope.performDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            codefileResource.deleteByPath('partialViewMacros', $scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                //TODO: Need to sync tree, etc...
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.PartialViewMacros.DeleteController', PartialViewMacrosDeleteController);
    'use strict';
    (function () {
        'use strict';
        function partialViewMacrosEditController($scope, $routeParams, codefileResource, assetsService, notificationsService, editorState, navigationService, appState, macroService, angularHelper, $timeout, contentEditingHelper, localizationService, templateHelper, macroResource, editorService) {
            var vm = this;
            vm.page = {};
            vm.page.loading = true;
            vm.partialViewMacroFile = {};
            //menu
            vm.page.menu = {};
            vm.page.menu.currentSection = appState.getSectionState('currentSection');
            vm.page.menu.currentNode = null;
            // insert buttons
            vm.page.insertDefaultButton = {
                labelKey: 'general_insert',
                addEllipsis: 'true',
                handler: function handler() {
                    vm.openInsertOverlay();
                }
            };
            vm.page.insertSubButtons = [
                {
                    labelKey: 'template_insertPageField',
                    addEllipsis: 'true',
                    handler: function handler() {
                        vm.openPageFieldOverlay();
                    }
                },
                {
                    labelKey: 'template_insertMacro',
                    addEllipsis: 'true',
                    handler: function handler() {
                        vm.openMacroOverlay();
                    }
                },
                {
                    labelKey: 'template_insertDictionaryItem',
                    addEllipsis: 'true',
                    handler: function handler() {
                        vm.openDictionaryItemOverlay();
                    }
                }
            ];
            // bind functions to view model
            vm.save = save;
            vm.openPageFieldOverlay = openPageFieldOverlay;
            vm.openDictionaryItemOverlay = openDictionaryItemOverlay;
            vm.openQueryBuilderOverlay = openQueryBuilderOverlay;
            vm.openMacroOverlay = openMacroOverlay;
            vm.openInsertOverlay = openInsertOverlay;
            /* Functions bound to view model */
            function save() {
                vm.page.saveButtonState = 'busy';
                vm.partialViewMacro.content = vm.editor.getValue();
                contentEditingHelper.contentEditorPerformSave({
                    saveMethod: codefileResource.save,
                    scope: $scope,
                    content: vm.partialViewMacro,
                    // We do not redirect on failure for partial view macros - this is because it is not possible to actually save the partial view
                    // when server side validation fails - as opposed to content where we are capable of saving the content
                    // item if server side validation fails
                    redirectOnFailure: false,
                    rebindCallback: function rebindCallback(orignal, saved) {
                    }
                }).then(function (saved) {
                    // create macro if needed
                    if ($routeParams.create && $routeParams.nomacro !== 'true') {
                        macroResource.createPartialViewMacroWithFile(saved.virtualPath, saved.name).then(function (created) {
                            completeSave(saved);
                        }, angular.noop);
                    } else {
                        completeSave(saved);
                    }
                }, function (err) {
                    vm.page.saveButtonState = 'error';
                    localizationService.localize('speechBubbles_validationFailedHeader').then(function (headerValue) {
                        localizationService.localize('speechBubbles_validationFailedMessage').then(function (msgValue) {
                            notificationsService.error(headerValue, msgValue);
                        });
                    });
                });
            }
            function completeSave(saved) {
                localizationService.localize('speechBubbles_partialViewSavedHeader').then(function (headerValue) {
                    localizationService.localize('speechBubbles_partialViewSavedText').then(function (msgValue) {
                        notificationsService.success(headerValue, msgValue);
                    });
                });
                //check if the name changed, if so we need to redirect
                if (vm.partialViewMacro.id !== saved.id) {
                    contentEditingHelper.redirectToRenamedContent(saved.id);
                } else {
                    vm.page.saveButtonState = 'success';
                    vm.partialViewMacro = saved;
                    //sync state
                    editorState.set(vm.partialViewMacro);
                    // normal tree sync
                    navigationService.syncTree({
                        tree: 'partialViewMacros',
                        path: vm.partialViewMacro.path,
                        forceReload: true
                    }).then(function (syncArgs) {
                        vm.page.menu.currentNode = syncArgs.node;
                    });
                    // clear $dirty state on form
                    setFormState('pristine');
                }
            }
            function openInsertOverlay() {
                var insertOverlay = {
                    allowedTypes: {
                        macro: true,
                        dictionary: true,
                        umbracoField: true
                    },
                    submit: function submit(model) {
                        switch (model.insert.type) {
                        case 'macro':
                            var macroObject = macroService.collectValueData(model.insert.selectedMacro, model.insert.macroParams, 'Mvc');
                            insert(macroObject.syntax);
                            break;
                        case 'dictionary':
                            var code = templateHelper.getInsertDictionarySnippet(model.insert.node.name);
                            insert(code);
                            break;
                        case 'umbracoField':
                            insert(model.insert.umbracoField);
                            break;
                        }
                        editorService.close();
                    },
                    close: function close(oldModel) {
                        // close the dialog
                        editorService.close();
                        // focus editor
                        vm.editor.focus();
                    }
                };
                editorService.insertCodeSnippet(insertOverlay);
            }
            function openMacroOverlay() {
                var macroPicker = {
                    dialogData: {},
                    submit: function submit(model) {
                        var macroObject = macroService.collectValueData(model.selectedMacro, model.macroParams, 'Mvc');
                        insert(macroObject.syntax);
                        editorService.close();
                    },
                    close: function close() {
                        editorService.close();
                        vm.editor.focus();
                    }
                };
                editorService.macroPicker(macroPicker);
            }
            function openPageFieldOverlay() {
                var insertFieldEditor = {
                    submit: function submit(model) {
                        insert(model.umbracoField);
                        editorService.close();
                    },
                    close: function close() {
                        editorService.close();
                        vm.editor.focus();
                    }
                };
                editorService.insertField(insertFieldEditor);
            }
            function openDictionaryItemOverlay() {
                var labelKeys = [
                    'template_insertDictionaryItem',
                    'emptyStates_emptyDictionaryTree'
                ];
                localizationService.localizeMany(labelKeys).then(function (values) {
                    var title = values[0];
                    var emptyStateMessage = values[1];
                    var dictionaryPicker = {
                        section: 'translation',
                        treeAlias: 'dictionary',
                        entityType: 'dictionary',
                        multiPicker: false,
                        title: title,
                        emptyStateMessage: emptyStateMessage,
                        select: function select(node) {
                            var code = templateHelper.getInsertDictionarySnippet(node.name);
                            insert(code);
                            editorService.close();
                        },
                        close: function close(model) {
                            // close dialog
                            editorService.close();
                            // focus editor
                            vm.editor.focus();
                        }
                    };
                    editorService.treePicker(dictionaryPicker);
                });
            }
            function openQueryBuilderOverlay() {
                var queryBuilder = {
                    submit: function submit(model) {
                        var code = templateHelper.getQuerySnippet(model.result.queryExpression);
                        insert(code);
                        editorService.close();
                    },
                    close: function close(model) {
                        // close dialog
                        editorService.close();
                        // focus editor
                        vm.editor.focus();
                    }
                };
                editorService.queryBuilder(queryBuilder);
            }
            /* Local functions */
            function init() {
                //we need to load this somewhere, for now its here.
                assetsService.loadCss('lib/ace-razor-mode/theme/razor_chrome.css', $scope);
                if ($routeParams.create) {
                    var snippet = 'Empty';
                    if ($routeParams.snippet) {
                        snippet = $routeParams.snippet;
                    }
                    codefileResource.getScaffold('partialViewMacros', $routeParams.id, snippet).then(function (partialViewMacro) {
                        if ($routeParams.name) {
                            partialViewMacro.name = $routeParams.name;
                        }
                        ready(partialViewMacro, false);
                    });
                } else {
                    codefileResource.getByPath('partialViewMacros', $routeParams.id).then(function (partialViewMacro) {
                        ready(partialViewMacro, true);
                    });
                }
            }
            function ready(partialViewMacro, syncTree) {
                vm.page.loading = false;
                vm.partialViewMacro = partialViewMacro;
                //sync state
                editorState.set(vm.partialViewMacro);
                if (syncTree) {
                    navigationService.syncTree({
                        tree: 'partialViewMacros',
                        path: vm.partialViewMacro.path,
                        forceReload: true
                    }).then(function (syncArgs) {
                        vm.page.menu.currentNode = syncArgs.node;
                    });
                }
                // ace configuration
                vm.aceOption = {
                    mode: 'razor',
                    theme: 'chrome',
                    showPrintMargin: false,
                    advanced: { fontSize: '14px' },
                    onLoad: function onLoad(_editor) {
                        vm.editor = _editor;
                        // initial cursor placement
                        // Keep cursor in name field if we are create a new template
                        // else set the cursor at the bottom of the code editor
                        if (!$routeParams.create) {
                            $timeout(function () {
                                vm.editor.navigateFileEnd();
                                vm.editor.focus();
                                persistCurrentLocation();
                            });
                        }
                        //change on blur, focus
                        vm.editor.on('blur', persistCurrentLocation);
                        vm.editor.on('focus', persistCurrentLocation);
                        vm.editor.on('change', changeAceEditor);
                    }
                };
            }
            function insert(str) {
                vm.editor.focus();
                vm.editor.moveCursorToPosition(vm.currentPosition);
                vm.editor.insert(str);
                // set form state to $dirty
                setFormState('dirty');
            }
            function persistCurrentLocation() {
                vm.currentPosition = vm.editor.getCursorPosition();
            }
            function changeAceEditor() {
                setFormState('dirty');
            }
            function setFormState(state) {
                // get the current form
                var currentForm = angularHelper.getCurrentForm($scope);
                // set state
                if (state === 'dirty') {
                    currentForm.$setDirty();
                } else if (state === 'pristine') {
                    currentForm.$setPristine();
                }
            }
            init();
        }
        angular.module('umbraco').controller('Umbraco.Editors.PartialViewMacros.EditController', partialViewMacrosEditController);
    }());
    'use strict';
    (function () {
        'use strict';
        function PartialViewsCreateController($scope, codefileResource, $location, navigationService, formHelper, appState) {
            var vm = this;
            var node = $scope.currentNode;
            vm.snippets = [];
            vm.showSnippets = false;
            vm.creatingFolder = false;
            vm.createFolderError = '';
            vm.folderName = '';
            vm.createPartialView = createPartialView;
            vm.showCreateFolder = showCreateFolder;
            vm.createFolder = createFolder;
            vm.showCreateFromSnippet = showCreateFromSnippet;
            vm.close = close;
            function onInit() {
                codefileResource.getSnippets('partialViews').then(function (snippets) {
                    vm.snippets = snippets;
                });
            }
            function createPartialView(selectedSnippet) {
                var snippet = null;
                if (selectedSnippet && selectedSnippet.fileName) {
                    snippet = selectedSnippet.fileName;
                }
                $location.path('/settings/partialviews/edit/' + node.id).search('create', 'true').search('snippet', snippet);
                navigationService.hideMenu();
            }
            function showCreateFolder() {
                vm.creatingFolder = true;
            }
            function createFolder(form) {
                if (formHelper.submitForm({
                        scope: $scope,
                        formCtrl: form
                    })) {
                    codefileResource.createContainer('partialViews', node.id, vm.folderName).then(function (saved) {
                        navigationService.hideMenu();
                        navigationService.syncTree({
                            tree: 'partialViews',
                            path: saved.path,
                            forceReload: true,
                            activate: true
                        });
                        formHelper.resetForm({ scope: $scope });
                        var section = appState.getSectionState('currentSection');
                    }, function (err) {
                        vm.createFolderError = err;
                    });
                }
            }
            function showCreateFromSnippet() {
                vm.showSnippets = true;
            }
            function close() {
                var showMenu = true;
                navigationService.hideDialog(showMenu);
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.PartialViews.CreateController', PartialViewsCreateController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.PartialViews.DeleteController
 * @function
 *
 * @description
 * The controller for deleting partial views
 */
    function PartialViewsDeleteController($scope, codefileResource, treeService, navigationService) {
        $scope.performDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            codefileResource.deleteByPath('partialViews', $scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                //TODO: Need to sync tree, etc...
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.PartialViews.DeleteController', PartialViewsDeleteController);
    'use strict';
    (function () {
        'use strict';
        function PartialViewsEditController($scope, $routeParams, codefileResource, assetsService, notificationsService, editorState, navigationService, appState, macroService, angularHelper, $timeout, contentEditingHelper, localizationService, templateHelper, editorService) {
            var vm = this;
            vm.page = {};
            vm.page.loading = true;
            vm.partialView = {};
            //menu
            vm.page.menu = {};
            vm.page.menu.currentSection = appState.getSectionState('currentSection');
            vm.page.menu.currentNode = null;
            // insert buttons
            vm.page.insertDefaultButton = {
                labelKey: 'general_insert',
                addEllipsis: 'true',
                handler: function handler() {
                    vm.openInsertOverlay();
                }
            };
            vm.page.insertSubButtons = [
                {
                    labelKey: 'template_insertPageField',
                    addEllipsis: 'true',
                    handler: function handler() {
                        vm.openPageFieldOverlay();
                    }
                },
                {
                    labelKey: 'template_insertMacro',
                    addEllipsis: 'true',
                    handler: function handler() {
                        vm.openMacroOverlay();
                    }
                },
                {
                    labelKey: 'template_insertDictionaryItem',
                    addEllipsis: 'true',
                    handler: function handler() {
                        vm.openDictionaryItemOverlay();
                    }
                }
            ];
            //Used to toggle the keyboard shortcut modal
            //From a custom keybinding in ace editor - that conflicts with our own to show the dialog
            vm.showKeyboardShortcut = false;
            //Keyboard shortcuts for help dialog
            vm.page.keyboardShortcutsOverview = [];
            templateHelper.getGeneralShortcuts().then(function (data) {
                vm.page.keyboardShortcutsOverview.push(data);
            });
            templateHelper.getEditorShortcuts().then(function (data) {
                vm.page.keyboardShortcutsOverview.push(data);
            });
            templateHelper.getPartialViewEditorShortcuts().then(function (data) {
                vm.page.keyboardShortcutsOverview.push(data);
            });
            // bind functions to view model
            vm.save = save;
            vm.openPageFieldOverlay = openPageFieldOverlay;
            vm.openDictionaryItemOverlay = openDictionaryItemOverlay;
            vm.openQueryBuilderOverlay = openQueryBuilderOverlay;
            vm.openMacroOverlay = openMacroOverlay;
            vm.openInsertOverlay = openInsertOverlay;
            /* Functions bound to view model */
            function save() {
                vm.page.saveButtonState = 'busy';
                vm.partialView.content = vm.editor.getValue();
                contentEditingHelper.contentEditorPerformSave({
                    saveMethod: codefileResource.save,
                    scope: $scope,
                    content: vm.partialView,
                    //We do not redirect on failure for partialviews - this is because it is not possible to actually save the partialviews
                    // type when server side validation fails - as opposed to content where we are capable of saving the content
                    // item if server side validation fails
                    redirectOnFailure: false,
                    rebindCallback: function rebindCallback(orignal, saved) {
                    }
                }).then(function (saved) {
                    localizationService.localize('speechBubbles_partialViewSavedHeader').then(function (headerValue) {
                        localizationService.localize('speechBubbles_partialViewSavedText').then(function (msgValue) {
                            notificationsService.success(headerValue, msgValue);
                        });
                    });
                    //check if the name changed, if so we need to redirect
                    if (vm.partialView.id !== saved.id) {
                        contentEditingHelper.redirectToRenamedContent(saved.id);
                    } else {
                        vm.page.saveButtonState = 'success';
                        vm.partialView = saved;
                        //sync state
                        editorState.set(vm.partialView);
                        // normal tree sync
                        navigationService.syncTree({
                            tree: 'partialViews',
                            path: vm.partialView.path,
                            forceReload: true
                        }).then(function (syncArgs) {
                            vm.page.menu.currentNode = syncArgs.node;
                        });
                        // clear $dirty state on form
                        setFormState('pristine');
                    }
                }, function (err) {
                    vm.page.saveButtonState = 'error';
                    localizationService.localize('speechBubbles_validationFailedHeader').then(function (headerValue) {
                        localizationService.localize('speechBubbles_validationFailedMessage').then(function (msgValue) {
                            notificationsService.error(headerValue, msgValue);
                        });
                    });
                });
            }
            function openInsertOverlay() {
                var insertOverlay = {
                    allowedTypes: {
                        macro: true,
                        dictionary: true,
                        umbracoField: true
                    },
                    submit: function submit(model) {
                        switch (model.insert.type) {
                        case 'macro':
                            var macroObject = macroService.collectValueData(model.insert.selectedMacro, model.insert.macroParams, 'Mvc');
                            insert(macroObject.syntax);
                            break;
                        case 'dictionary':
                            var code = templateHelper.getInsertDictionarySnippet(model.insert.node.name);
                            insert(code);
                            break;
                        case 'umbracoField':
                            insert(model.insert.umbracoField);
                            break;
                        }
                        editorService.close();
                    },
                    close: function close() {
                        // close the dialog
                        editorService.close();
                        // focus editor
                        vm.editor.focus();
                    }
                };
                editorService.insertCodeSnippet(insertOverlay);
            }
            function openMacroOverlay() {
                var macroPicker = {
                    dialogData: {},
                    submit: function submit(model) {
                        var macroObject = macroService.collectValueData(model.selectedMacro, model.macroParams, 'Mvc');
                        insert(macroObject.syntax);
                        editorService.close();
                    },
                    close: function close() {
                        editorService.close();
                        vm.editor.focus();
                    }
                };
                editorService.macroPicker(macroPicker);
            }
            function openPageFieldOverlay() {
                var insertFieldEditor = {
                    submit: function submit(model) {
                        insert(model.umbracoField);
                        editorService.close();
                    },
                    close: function close() {
                        editorService.close();
                        vm.editor.focus();
                    }
                };
                editorService.insertField(insertFieldEditor);
            }
            function openDictionaryItemOverlay() {
                var labelKeys = [
                    'template_insertDictionaryItem',
                    'emptyStates_emptyDictionaryTree'
                ];
                localizationService.localizeMany(labelKeys).then(function (values) {
                    var title = values[0];
                    var emptyStateMessage = values[1];
                    var dictionaryItem = {
                        section: 'translation',
                        treeAlias: 'dictionary',
                        entityType: 'dictionary',
                        multiPicker: false,
                        title: title,
                        emptyStateMessage: emptyStateMessage,
                        select: function select(node) {
                            var code = templateHelper.getInsertDictionarySnippet(node.name);
                            insert(code);
                            editorService.close();
                        },
                        close: function close(model) {
                            // close dialog
                            editorService.close();
                            // focus editor
                            vm.editor.focus();
                        }
                    };
                    editorService.treePicker(dictionaryItem);
                });
            }
            function openQueryBuilderOverlay() {
                var queryBuilder = {
                    title: 'Query for content',
                    submit: function submit(model) {
                        var code = templateHelper.getQuerySnippet(model.result.queryExpression);
                        insert(code);
                        editorService.close();
                    },
                    close: function close() {
                        // close dialog
                        editorService.close();
                        // focus editor
                        vm.editor.focus();
                    }
                };
                editorService.queryBuilder(queryBuilder);
            }
            /* Local functions */
            function init() {
                //we need to load this somewhere, for now its here.
                assetsService.loadCss('lib/ace-razor-mode/theme/razor_chrome.css', $scope);
                if ($routeParams.create) {
                    var snippet = 'Empty';
                    if ($routeParams.snippet) {
                        snippet = $routeParams.snippet;
                    }
                    codefileResource.getScaffold('partialViews', $routeParams.id, snippet).then(function (partialView) {
                        ready(partialView, false);
                    });
                } else {
                    codefileResource.getByPath('partialViews', $routeParams.id).then(function (partialView) {
                        ready(partialView, true);
                    });
                }
            }
            function ready(partialView, syncTree) {
                vm.page.loading = false;
                vm.partialView = partialView;
                //sync state
                editorState.set(vm.partialView);
                if (syncTree) {
                    navigationService.syncTree({
                        tree: 'partialViews',
                        path: vm.partialView.path,
                        forceReload: true
                    }).then(function (syncArgs) {
                        vm.page.menu.currentNode = syncArgs.node;
                    });
                }
                // ace configuration
                vm.aceOption = {
                    mode: 'razor',
                    theme: 'chrome',
                    showPrintMargin: false,
                    advanced: { fontSize: '14px' },
                    onLoad: function onLoad(_editor) {
                        vm.editor = _editor;
                        //Update the auto-complete method to use ctrl+alt+space
                        _editor.commands.bindKey('ctrl-alt-space', 'startAutocomplete');
                        //Unassigns the keybinding (That was previously auto-complete)
                        //As conflicts with our own tree search shortcut
                        _editor.commands.bindKey('ctrl-space', null);
                        // Assign new keybinding
                        _editor.commands.addCommands([
                            //Disable (alt+shift+K)
                            //Conflicts with our own show shortcuts dialog - this overrides it
                            {
                                name: 'unSelectOrFindPrevious',
                                bindKey: 'Alt-Shift-K',
                                exec: function exec() {
                                    //Toggle the show keyboard shortcuts overlay
                                    $scope.$apply(function () {
                                        vm.showKeyboardShortcut = !vm.showKeyboardShortcut;
                                    });
                                },
                                readOnly: true
                            },
                            {
                                name: 'insertUmbracoValue',
                                bindKey: 'Alt-Shift-V',
                                exec: function exec() {
                                    $scope.$apply(function () {
                                        openPageFieldOverlay();
                                    });
                                },
                                readOnly: true
                            },
                            {
                                name: 'insertDictionary',
                                bindKey: 'Alt-Shift-D',
                                exec: function exec() {
                                    $scope.$apply(function () {
                                        openDictionaryItemOverlay();
                                    });
                                },
                                readOnly: true
                            },
                            {
                                name: 'insertUmbracoMacro',
                                bindKey: 'Alt-Shift-M',
                                exec: function exec() {
                                    $scope.$apply(function () {
                                        openMacroOverlay();
                                    });
                                },
                                readOnly: true
                            },
                            {
                                name: 'insertQuery',
                                bindKey: 'Alt-Shift-Q',
                                exec: function exec() {
                                    $scope.$apply(function () {
                                        openQueryBuilderOverlay();
                                    });
                                },
                                readOnly: true
                            }
                        ]);
                        // initial cursor placement
                        // Keep cursor in name field if we are create a new template
                        // else set the cursor at the bottom of the code editor
                        if (!$routeParams.create) {
                            $timeout(function () {
                                vm.editor.navigateFileEnd();
                                vm.editor.focus();
                                persistCurrentLocation();
                            });
                        }
                        //change on blur, focus
                        vm.editor.on('blur', persistCurrentLocation);
                        vm.editor.on('focus', persistCurrentLocation);
                        vm.editor.on('change', changeAceEditor);
                    }
                };
            }
            function insert(str) {
                vm.editor.focus();
                vm.editor.moveCursorToPosition(vm.currentPosition);
                vm.editor.insert(str);
                // set form state to $dirty
                setFormState('dirty');
            }
            function persistCurrentLocation() {
                vm.currentPosition = vm.editor.getCursorPosition();
            }
            function changeAceEditor() {
                setFormState('dirty');
            }
            function setFormState(state) {
                // get the current form
                var currentForm = angularHelper.getCurrentForm($scope);
                // set state
                if (state === 'dirty') {
                    currentForm.$setDirty();
                } else if (state === 'pristine') {
                    currentForm.$setPristine();
                }
            }
            init();
        }
        angular.module('umbraco').controller('Umbraco.Editors.PartialViews.EditController', PartialViewsEditController);
    }());
    'use strict';
    angular.module('umbraco').controller('Umbraco.PrevalueEditors.BooleanController', function ($scope) {
        function updateToggleValue() {
            $scope.toggleValue = false;
            if ($scope.model && Object.toBoolean($scope.model.value)) {
                $scope.toggleValue = true;
            }
        }
        if ($scope.model.value === null) {
            $scope.model.value = '0';
        }
        updateToggleValue();
        $scope.toggle = function () {
            if (Object.toBoolean($scope.model.value)) {
                $scope.model.value = '0';
                updateToggleValue();
                return;
            }
            $scope.model.value = '1';
            updateToggleValue();
        };
    });
    'use strict';
    angular.module('umbraco').controller('Umbraco.PrevalueEditors.ColorPickerController', function ($scope) {
        //setup the default config
        var config = { useLabel: false };
        //map the user config
        angular.extend(config, $scope.model.config);
        //map back to the model
        $scope.model.config = config;
        $scope.isConfigured = $scope.model.prevalues && _.keys($scope.model.prevalues).length > 0;
        $scope.model.items = [];
        // Make an array from the dictionary
        var items = [];
        if (angular.isArray($scope.model.prevalues)) {
            for (var i in $scope.model.prevalues) {
                var oldValue = $scope.model.prevalues[i];
                if (!isValidHex(oldValue.value || oldValue))
                    continue;
                if (oldValue.hasOwnProperty('value')) {
                    var hexCode = toFullHex(oldValue.value);
                    items.push({
                        value: hexCode.substr(1, hexCode.length),
                        label: oldValue.label,
                        id: i
                    });
                } else {
                    var hexCode = toFullHex(oldValue);
                    items.push({
                        value: hexCode.substr(1, hexCode.length),
                        label: oldValue,
                        id: i
                    });
                }
            }
            // Now make the editor model the array
            $scope.model.items = items;
        }
        function toFullHex(hex) {
            if (hex.length === 4 && hex.charAt(0) === '#') {
                hex = '#' + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2) + hex.charAt(3) + hex.charAt(3);
            }
            return hex.toLowerCase();
        }
        function isValidHex(str) {
            return /(^#[0-9A-F]{6}$)|(^#[0-9A-F]{3}$)/i.test(str);
        }
    });
    'use strict';
    function imageFilePickerController($scope) {
        $scope.add = function () {
            $scope.mediaPickerOverlay = {
                view: 'mediapicker',
                disableFolderSelect: true,
                onlyImages: true,
                show: true,
                submit: function submit(model) {
                    $scope.model.value = model.selectedImages[0].image;
                    $scope.mediaPickerOverlay.show = false;
                    $scope.mediaPickerOverlay = null;
                },
                close: function close() {
                    $scope.mediaPickerOverlay.show = false;
                    $scope.mediaPickerOverlay = null;
                }
            };
        };
        $scope.remove = function () {
            $scope.model.value = null;
        };
    }
    angular.module('umbraco').controller('Umbraco.PrevalueEditors.ImageFilePickerController', imageFilePickerController);
    'use strict';
    //this controller simply tells the dialogs service to open a mediaPicker window
    //with a specified callback, this callback will receive an object with a selection on it
    function mediaPickerController($scope, entityResource, iconHelper, editorService) {
        function trim(str, chr) {
            var rgxtrim = !chr ? new RegExp('^\\s+|\\s+$', 'g') : new RegExp('^' + chr + '+|' + chr + '+$', 'g');
            return str.replace(rgxtrim, '');
        }
        $scope.renderModel = [];
        $scope.allowRemove = true;
        $scope.allowEdit = true;
        $scope.sortable = false;
        var dialogOptions = {
            multiPicker: false,
            entityType: 'Media',
            section: 'media',
            treeAlias: 'media',
            idType: 'int'
        };
        //combine the dialogOptions with any values returned from the server
        if ($scope.model.config) {
            angular.extend(dialogOptions, $scope.model.config);
        }
        $scope.openTreePicker = function () {
            var treePicker = dialogOptions;
            treePicker.submit = function (model) {
                if (treePicker.multiPicker) {
                    _.each(model.selection, function (item, i) {
                        $scope.add(item);
                    });
                } else {
                    $scope.clear();
                    $scope.add(model.selection[0]);
                }
                editorService.close();
            };
            treePicker.close = function () {
                editorService.close();
            };
            editorService.treePicker(treePicker);
        };
        $scope.remove = function (index) {
            $scope.renderModel.splice(index, 1);
        };
        $scope.clear = function () {
            $scope.renderModel = [];
        };
        $scope.add = function (item) {
            var itemId = dialogOptions.idType === 'udi' ? item.udi : item.id;
            var currIds = _.map($scope.renderModel, function (i) {
                return dialogOptions.idType === 'udi' ? i.udi : i.id;
            });
            if (currIds.indexOf(itemId) < 0) {
                item.icon = iconHelper.convertFromLegacyIcon(item.icon);
                $scope.renderModel.push({
                    name: item.name,
                    id: item.id,
                    icon: item.icon,
                    udi: item.udi
                });
                // store the index of the new item in the renderModel collection so we can find it again
                var itemRenderIndex = $scope.renderModel.length - 1;
                // get and update the path for the picked node
                entityResource.getUrl(item.id, dialogOptions.entityType).then(function (data) {
                    $scope.renderModel[itemRenderIndex].path = data;
                });
            }
        };
        var unsubscribe = $scope.$on('formSubmitting', function (ev, args) {
            var currIds = _.map($scope.renderModel, function (i) {
                return dialogOptions.idType === 'udi' ? i.udi : i.id;
            });
            $scope.model.value = trim(currIds.join(), ',');
        });
        //when the scope is destroyed we need to unsubscribe
        $scope.$on('$destroy', function () {
            unsubscribe();
        });
        //load media data
        var modelIds = $scope.model.value ? $scope.model.value.split(',') : [];
        if (modelIds.length > 0) {
            entityResource.getByIds(modelIds, dialogOptions.entityType).then(function (data) {
                _.each(data, function (item, i) {
                    item.icon = iconHelper.convertFromLegacyIcon(item.icon);
                    $scope.renderModel.push({
                        name: item.name,
                        id: item.id,
                        icon: item.icon,
                        udi: item.udi
                    });
                    // store the index of the new item in the renderModel collection so we can find it again
                    var itemRenderIndex = $scope.renderModel.length - 1;
                    // get and update the path for the picked node
                    entityResource.getUrl(item.id, dialogOptions.entityType).then(function (data) {
                        $scope.renderModel[itemRenderIndex].path = data;
                    });
                });
            });
        }
    }
    angular.module('umbraco').controller('Umbraco.PrevalueEditors.MediaPickerController', mediaPickerController);
    'use strict';
    angular.module('umbraco').controller('Umbraco.PrevalueEditors.MultiValuesController', function ($scope, $timeout) {
        //NOTE: We need to make each item an object, not just a string because you cannot 2-way bind to a primitive.
        $scope.newItem = '';
        $scope.hasError = false;
        $scope.focusOnNew = false;
        if (!angular.isArray($scope.model.value)) {
            //make an array from the dictionary
            var items = [];
            for (var i in $scope.model.value) {
                items.push({
                    value: $scope.model.value[i].value,
                    sortOrder: $scope.model.value[i].sortOrder,
                    id: i
                });
            }
            //ensure the items are sorted by the provided sort order
            items.sort(function (a, b) {
                return a.sortOrder > b.sortOrder ? 1 : b.sortOrder > a.sortOrder ? -1 : 0;
            });
            //now make the editor model the array
            $scope.model.value = items;
        }
        $scope.remove = function (item, evt) {
            evt.preventDefault();
            $scope.model.value = _.reject($scope.model.value, function (x) {
                return x.value === item.value;
            });
        };
        $scope.add = function (evt) {
            evt.preventDefault();
            if ($scope.newItem) {
                if (!_.contains($scope.model.value, $scope.newItem)) {
                    $scope.model.value.push({ value: $scope.newItem });
                    $scope.newItem = '';
                    $scope.hasError = false;
                    $scope.focusOnNew = true;
                    return;
                }
            }
            //there was an error, do the highlight (will be set back by the directive)
            $scope.hasError = true;
        };
        $scope.sortableOptions = {
            axis: 'y',
            containment: 'parent',
            cursor: 'move',
            items: '> div.control-group',
            tolerance: 'pointer',
            update: function update(e, ui) {
                // Get the new and old index for the moved element (using the text as the identifier, so 
                // we'd have a problem if two prevalues were the same, but that would be unlikely)
                var newIndex = ui.item.index();
                var movedPrevalueText = $('input[type="text"]', ui.item).val();
                var originalIndex = getElementIndexByPrevalueText(movedPrevalueText);
                // Move the element in the model
                if (originalIndex > -1) {
                    var movedElement = $scope.model.value[originalIndex];
                    $scope.model.value.splice(originalIndex, 1);
                    $scope.model.value.splice(newIndex, 0, movedElement);
                }
            }
        };
        $scope.createNew = function (event) {
            if (event.keyCode == 13) {
                $scope.add(event);
            }
        };
        function getElementIndexByPrevalueText(value) {
            for (var i = 0; i < $scope.model.value.length; i++) {
                if ($scope.model.value[i].value === value) {
                    return i;
                }
            }
            return -1;
        }
    });
    'use strict';
    //this controller simply tells the dialogs service to open a mediaPicker window
    //with a specified callback, this callback will receive an object with a selection on it
    angular.module('umbraco').controller('Umbraco.PrevalueEditors.TreePickerController', function ($scope, entityResource, iconHelper, editorService) {
        $scope.renderModel = [];
        $scope.ids = [];
        $scope.allowRemove = true;
        $scope.allowEdit = true;
        $scope.sortable = false;
        var config = {
            multiPicker: false,
            entityType: 'Document',
            type: 'content',
            treeAlias: 'content',
            idType: 'int'
        };
        //combine the config with any values returned from the server
        if ($scope.model.config) {
            angular.extend(config, $scope.model.config);
        }
        if ($scope.model.value) {
            if (Array.isArray($scope.model.value)) {
                $scope.ids = $scope.model.value.split(',');
            } else {
                $scope.ids.push($scope.model.value);
            }
            entityResource.getByIds($scope.ids, config.entityType).then(function (data) {
                _.each(data, function (item, i) {
                    item.icon = iconHelper.convertFromLegacyIcon(item.icon);
                    $scope.renderModel.push({
                        name: item.name,
                        id: item.id,
                        icon: item.icon,
                        udi: item.udi
                    });
                    // store the index of the new item in the renderModel collection so we can find it again
                    var itemRenderIndex = $scope.renderModel.length - 1;
                    // get and update the path for the picked node
                    entityResource.getUrl(item.id, config.entityType).then(function (data) {
                        $scope.renderModel[itemRenderIndex].path = data;
                    });
                });
            });
        }
        $scope.openContentPicker = function () {
            var treePicker = config;
            treePicker.section = config.type;
            treePicker.submit = function (model) {
                if (config.multiPicker) {
                    populate(model.selection);
                } else {
                    populate(model.selection[0]);
                }
                editorService.close();
            };
            treePicker.close = function () {
                editorService.close();
            };
            editorService.treePicker(treePicker);
        };
        $scope.remove = function (index) {
            $scope.renderModel.splice(index, 1);
            $scope.ids.splice(index, 1);
            $scope.model.value = trim($scope.ids.join(), ',');
        };
        $scope.clear = function () {
            $scope.model.value = '';
            $scope.renderModel = [];
            $scope.ids = [];
        };
        $scope.add = function (item) {
            var itemId = config.idType === 'udi' ? item.udi : item.id;
            if ($scope.ids.indexOf(itemId) < 0) {
                item.icon = iconHelper.convertFromLegacyIcon(item.icon);
                $scope.ids.push(itemId);
                $scope.renderModel.push({
                    name: item.name,
                    id: item.id,
                    icon: item.icon,
                    udi: item.udi
                });
                $scope.model.value = trim($scope.ids.join(), ',');
                // store the index of the new item in the renderModel collection so we can find it again
                var itemRenderIndex = $scope.renderModel.length - 1;
                // get and update the path for the picked node
                entityResource.getUrl(item.id, config.entityType).then(function (data) {
                    $scope.renderModel[itemRenderIndex].path = data;
                });
            }
        };
        var unsubscribe = $scope.$on('formSubmitting', function (ev, args) {
            $scope.model.value = trim($scope.ids.join(), ',');
        });
        //when the scope is destroyed we need to unsubscribe
        $scope.$on('$destroy', function () {
            unsubscribe();
        });
        function trim(str, chr) {
            var rgxtrim = !chr ? new RegExp('^\\s+|\\s+$', 'g') : new RegExp('^' + chr + '+|' + chr + '+$', 'g');
            return str.replace(rgxtrim, '');
        }
        function populate(data) {
            if (angular.isArray(data)) {
                _.each(data, function (item, i) {
                    $scope.add(item);
                });
            } else {
                $scope.clear();
                $scope.add(data);
            }
        }
    });
    'use strict';
    //this controller simply tells the dialogs service to open a mediaPicker window
    //with a specified callback, this callback will receive an object with a selection on it
    angular.module('umbraco').controller('Umbraco.PrevalueEditors.TreeSourceController', function ($scope, entityResource, iconHelper, editorService) {
        if (!$scope.model) {
            $scope.model = {};
        }
        if (!$scope.model.value) {
            $scope.model.value = { type: 'content' };
        }
        if (!$scope.model.config) {
            $scope.model.config = { idType: 'int' };
        }
        if ($scope.model.value.id && $scope.model.value.type !== 'member') {
            var ent = 'Document';
            if ($scope.model.value.type === 'media') {
                ent = 'Media';
            }
            entityResource.getById($scope.model.value.id, ent).then(function (item) {
                item.icon = iconHelper.convertFromLegacyIcon(item.icon);
                $scope.node = item;
            });
        }
        $scope.openContentPicker = function () {
            var treePicker = {
                idType: $scope.model.config.idType,
                section: $scope.model.value.type,
                treeAlias: $scope.model.value.type,
                multiPicker: false,
                submit: function submit(model) {
                    var item = model.selection[0];
                    populate(item);
                    editorService.close();
                },
                close: function close() {
                    editorService.close();
                }
            };
            editorService.treePicker(treePicker);
        };
        $scope.clear = function () {
            $scope.model.value.id = undefined;
            $scope.node = undefined;
            $scope.model.value.query = undefined;
        };
        //we always need to ensure we dont submit anything broken
        var unsubscribe = $scope.$on('formSubmitting', function (ev, args) {
            if ($scope.model.value.type === 'member') {
                $scope.model.value.id = -1;
                $scope.model.value.query = '';
            }
        });
        //when the scope is destroyed we need to unsubscribe
        $scope.$on('$destroy', function () {
            unsubscribe();
        });
        function populate(item) {
            $scope.clear();
            item.icon = iconHelper.convertFromLegacyIcon(item.icon);
            $scope.node = item;
            $scope.model.value.id = $scope.model.config.idType === 'udi' ? item.udi : item.id;
        }
    });
    'use strict';
    function booleanEditorController($scope) {
        function setupViewModel() {
            $scope.renderModel = { value: false };
            if ($scope.model.config && $scope.model.config.default && Object.toBoolean($scope.model.config.default) && $scope.model && !$scope.model.value) {
                $scope.renderModel.value = true;
            }
            if ($scope.model && $scope.model.value && Object.toBoolean($scope.model.value)) {
                $scope.renderModel.value = true;
            }
        }
        setupViewModel();
        if ($scope.model && !$scope.model.value) {
            $scope.model.value = $scope.renderModel.value === true ? '1' : '0';
        }
        //here we declare a special method which will be called whenever the value has changed from the server
        //this is instead of doing a watch on the model.value = faster
        $scope.model.onValueChanged = function (newVal, oldVal) {
            //update the display val again if it has changed from the server
            setupViewModel();
        };
        // Update the value when the toggle is clicked
        $scope.toggle = function () {
            if ($scope.renderModel.value) {
                $scope.model.value = '0';
                setupViewModel();
                return;
            }
            $scope.model.value = '1';
            setupViewModel();
        };
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.BooleanController', booleanEditorController);
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.ChangePasswordController', function ($scope, $routeParams) {
        $scope.isNew = $routeParams.create;
        function resetModel() {
            //the model config will contain an object, if it does not we'll create defaults
            //NOTE: We will not support doing the password regex on the client side because the regex on the server side
            //based on the membership provider cannot always be ported to js from .net directly.        
            /*
    {
        hasPassword: true/false,
        requiresQuestionAnswer: true/false,
        enableReset: true/false,
        enablePasswordRetrieval: true/false,
        minPasswordLength: 10
    }
    */
            //set defaults if they are not available
            if (!$scope.model.config || $scope.model.config.disableToggle === undefined) {
                $scope.model.config.disableToggle = false;
            }
            if (!$scope.model.config || $scope.model.config.hasPassword === undefined) {
                $scope.model.config.hasPassword = false;
            }
            if (!$scope.model.config || $scope.model.config.enablePasswordRetrieval === undefined) {
                $scope.model.config.enablePasswordRetrieval = true;
            }
            if (!$scope.model.config || $scope.model.config.requiresQuestionAnswer === undefined) {
                $scope.model.config.requiresQuestionAnswer = false;
            }
            if (!$scope.model.config || $scope.model.config.enableReset === undefined) {
                $scope.model.config.enableReset = true;
            }
            if (!$scope.model.config || $scope.model.config.minPasswordLength === undefined) {
                $scope.model.config.minPasswordLength = 0;
            }
            //set the model defaults
            if (!angular.isObject($scope.model.value)) {
                //if it's not an object then just create a new one
                $scope.model.value = {
                    newPassword: null,
                    oldPassword: null,
                    reset: null,
                    answer: null
                };
            } else {
                //just reset the values
                if (!$scope.isNew) {
                    //if it is new, then leave the generated pass displayed
                    $scope.model.value.newPassword = null;
                    $scope.model.value.oldPassword = null;
                }
                $scope.model.value.reset = null;
                $scope.model.value.answer = null;
            }
        }
        resetModel();
    });
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.CheckboxListController', function ($scope) {
        function init() {
            //we can't really do anything if the config isn't an object
            if (angular.isObject($scope.model.config.items)) {
                //now we need to format the items in the dictionary because we always want to have an array
                var configItems = [];
                var vals = _.values($scope.model.config.items);
                var keys = _.keys($scope.model.config.items);
                for (var i = 0; i < vals.length; i++) {
                    configItems.push({
                        id: keys[i],
                        sortOrder: vals[i].sortOrder,
                        value: vals[i].value
                    });
                }
                //ensure the items are sorted by the provided sort order
                configItems.sort(function (a, b) {
                    return a.sortOrder > b.sortOrder ? 1 : b.sortOrder > a.sortOrder ? -1 : 0;
                });
                if ($scope.model.value === null || $scope.model.value === undefined) {
                    $scope.model.value = [];
                }
                updateViewModel(configItems);
                //watch the model.value in case it changes so that we can keep our view model in sync
                $scope.$watchCollection('model.value', function (newVal) {
                    updateViewModel(configItems);
                });
            }
        }
        function updateViewModel(configItems) {
            //check if it's already in sync
            //get the checked vals from the view model
            var selectedVals = _.map(_.filter($scope.selectedItems, function (f) {
                return f.checked;
            }), function (m) {
                return m.key;
            });
            //get all of the same values between the arrays
            var same = _.intersection($scope.model.value, selectedVals);
            //if the lengths are the same as the value, then we are in sync, just exit
            if (same.length == $scope.model.value.length === selectedVals.length) {
                return;
            }
            $scope.selectedItems = [];
            for (var i = 0; i < configItems.length; i++) {
                var isChecked = _.contains($scope.model.value, configItems[i].id);
                $scope.selectedItems.push({
                    checked: isChecked,
                    key: configItems[i].id,
                    val: configItems[i].value
                });
            }
        }
        function changed(item) {
            var index = _.findIndex($scope.model.value, function (v) {
                return v === item.key;
            });
            if (item.checked) {
                //if it doesn't exist in the model, then add it
                if (index < 0) {
                    $scope.model.value.push(item.key);
                }
            } else {
                //if it exists in the model, then remove it
                if (index >= 0) {
                    $scope.model.value.splice(index, 1);
                }
            }
        }
        $scope.selectedItems = [];
        $scope.changed = changed;
        init();
    });
    'use strict';
    function ColorPickerController($scope) {
        //setup the default config
        var config = {
            items: [],
            multiple: false
        };
        //map the user config
        angular.extend(config, $scope.model.config);
        //map back to the model
        $scope.model.config = config;
        //TODO: This isn't used
        function convertArrayToDictionaryArray(model) {
            //now we need to format the items in the dictionary because we always want to have an array
            var newItems = [];
            for (var i = 0; i < model.length; i++) {
                newItems.push({
                    id: model[i],
                    sortOrder: 0,
                    value: model[i]
                });
            }
            return newItems;
        }
        //TODO: This isn't used
        function convertObjectToDictionaryArray(model) {
            //now we need to format the items in the dictionary because we always want to have an array
            var newItems = [];
            var vals = _.values($scope.model.config.items);
            var keys = _.keys($scope.model.config.items);
            for (var i = 0; i < vals.length; i++) {
                var label = vals[i].value ? vals[i].value : vals[i];
                newItems.push({
                    id: keys[i],
                    sortOrder: vals[i].sortOrder,
                    value: label
                });
            }
            return newItems;
        }
        $scope.isConfigured = $scope.model.config && $scope.model.config.items && _.keys($scope.model.config.items).length > 0;
        if ($scope.isConfigured) {
            for (var key in $scope.model.config.items) {
                if (!$scope.model.config.items[key].hasOwnProperty('value'))
                    $scope.model.config.items[key] = {
                        value: $scope.model.config.items[key],
                        label: $scope.model.config.items[key]
                    };
            }
            $scope.model.useLabel = isTrue($scope.model.config.useLabel);
            initActiveColor();
        }
        if (!angular.isArray($scope.model.config.items)) {
            //make an array from the dictionary
            var items = [];
            for (var i in $scope.model.config.items) {
                var oldValue = $scope.model.config.items[i];
                if (oldValue.hasOwnProperty('value')) {
                    items.push({
                        value: oldValue.value,
                        label: oldValue.label,
                        sortOrder: oldValue.sortOrder,
                        id: i
                    });
                } else {
                    items.push({
                        value: oldValue,
                        label: oldValue,
                        sortOrder: sortOrder,
                        id: i
                    });
                }
            }
            //ensure the items are sorted by the provided sort order
            items.sort(function (a, b) {
                return a.sortOrder > b.sortOrder ? 1 : b.sortOrder > a.sortOrder ? -1 : 0;
            });
            //now make the editor model the array
            $scope.model.config.items = items;
        }
        $scope.toggleItem = function (color) {
            var currentColor = $scope.model.value && $scope.model.value.hasOwnProperty('value') ? $scope.model.value.value : $scope.model.value;
            var newColor;
            if (currentColor === color.value) {
                // deselect
                $scope.model.value = $scope.model.useLabel ? {
                    value: '',
                    label: ''
                } : '';
                newColor = '';
            } else {
                // select
                $scope.model.value = $scope.model.useLabel ? {
                    value: color.value,
                    label: color.label
                } : color.value;
                newColor = color.value;
            }
            // this is required to re-validate
            $scope.propertyForm.modelValue.$setViewValue(newColor);
        };
        // Method required by the valPropertyValidator directive (returns true if the property editor has at least one color selected)
        $scope.validateMandatory = function () {
            var isValid = !$scope.model.validation.mandatory || $scope.model.value != null && $scope.model.value != '' && (!$scope.model.value.hasOwnProperty('value') || $scope.model.value.value !== '');
            return {
                isValid: isValid,
                errorMsg: 'Value cannot be empty',
                errorKey: 'required'
            };
        };
        $scope.isConfigured = $scope.model.config && $scope.model.config.items && _.keys($scope.model.config.items).length > 0;
        // A color is active if it matches the value and label of the model.
        // If the model doesn't store the label, ignore the label during the comparison.
        $scope.isActiveColor = function (color) {
            // no value
            if (!$scope.model.value)
                return false;
            // Complex color (value and label)?
            if (!$scope.model.value.hasOwnProperty('value'))
                return $scope.model.value === color.value;
            return $scope.model.value.value === color.value && $scope.model.value.label === color.label;
        };
        // Finds the color best matching the model's color,
        // and sets the model color to that one. This is useful when
        // either the value or label was changed on the data type.
        function initActiveColor() {
            // no value
            if (!$scope.model.value)
                return;
            // Complex color (value and label)?
            if (!$scope.model.value.hasOwnProperty('value'))
                return;
            var modelColor = $scope.model.value.value;
            var modelLabel = $scope.model.value.label;
            // Check for a full match or partial match.
            var foundItem = null;
            // Look for a fully matching color.
            for (var key in $scope.model.config.items) {
                var item = $scope.model.config.items[key];
                if (item.value == modelColor && item.label == modelLabel) {
                    foundItem = item;
                    break;
                }
            }
            // Look for a color with a matching value.
            if (!foundItem) {
                for (var key in $scope.model.config.items) {
                    var item = $scope.model.config.items[key];
                    if (item.value == modelColor) {
                        foundItem = item;
                        break;
                    }
                }
            }
            // Look for a color with a matching label.
            if (!foundItem) {
                for (var key in $scope.model.config.items) {
                    var item = $scope.model.config.items[key];
                    if (item.label == modelLabel) {
                        foundItem = item;
                        break;
                    }
                }
            }
            // If a match was found, set it as the active color.
            if (foundItem) {
                $scope.model.value.value = foundItem.value;
                $scope.model.value.label = foundItem.label;
            }
        }
        // figures out if a value is trueish enough
        function isTrue(bool) {
            return !!bool && bool !== '0' && bool.toString().toLowerCase() !== 'false';
        }
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.ColorPickerController', ColorPickerController);
    'use strict';
    angular.module('umbraco').controller('Umbraco.PrevalueEditors.MultiColorPickerController', function ($scope, $timeout, assetsService, angularHelper, $element, localizationService, eventsService) {
        //NOTE: We need to make each color an object, not just a string because you cannot 2-way bind to a primitive.
        var defaultColor = '000000';
        var defaultLabel = null;
        $scope.newColor = defaultColor;
        $scope.newLabel = defaultLabel;
        $scope.hasError = false;
        $scope.focusOnNew = false;
        $scope.labels = {};
        var labelKeys = [
            'general_cancel',
            'general_choose'
        ];
        $scope.labelEnabled = false;
        eventsService.on('toggleValue', function (e, args) {
            $scope.labelEnabled = args.value;
        });
        localizationService.localizeMany(labelKeys).then(function (values) {
            $scope.labels.cancel = values[0];
            $scope.labels.choose = values[1];
        });
        assetsService.load([//"lib/spectrum/tinycolor.js",
            'lib/spectrum/spectrum.js'], $scope).then(function () {
            var elem = $element.find('input[name=\'newColor\']');
            elem.spectrum({
                color: null,
                showInitial: false,
                chooseText: $scope.labels.choose,
                cancelText: $scope.labels.cancel,
                preferredFormat: 'hex',
                showInput: true,
                clickoutFiresChange: true,
                hide: function hide(color) {
                    //show the add butotn
                    $element.find('.btn.add').show();
                },
                change: function change(color) {
                    angularHelper.safeApply($scope, function () {
                        $scope.newColor = color.toHexString().trimStart('#');    // #ff0000
                    });
                },
                show: function show() {
                    //hide the add butotn
                    $element.find('.btn.add').hide();
                }
            });
        });
        if (!angular.isArray($scope.model.value)) {
            //make an array from the dictionary
            var items = [];
            for (var i in $scope.model.value) {
                var oldValue = $scope.model.value[i];
                if (oldValue.hasOwnProperty('value')) {
                    items.push({
                        value: oldValue.value,
                        label: oldValue.label,
                        sortOrder: oldValue.sortOrder,
                        id: i
                    });
                } else {
                    items.push({
                        value: oldValue,
                        label: oldValue,
                        sortOrder: sortOrder,
                        id: i
                    });
                }
            }
            //ensure the items are sorted by the provided sort order
            items.sort(function (a, b) {
                return a.sortOrder > b.sortOrder ? 1 : b.sortOrder > a.sortOrder ? -1 : 0;
            });
            //now make the editor model the array
            $scope.model.value = items;
        }
        // ensure labels
        for (var i = 0; i < $scope.model.value.length; i++) {
            var item = $scope.model.value[i];
            item.label = item.hasOwnProperty('label') ? item.label : item.value;
        }
        function validLabel(label) {
            return label !== null && typeof label !== 'undefined' && label !== '' && label.length && label.length > 0;
        }
        $scope.remove = function (item, evt) {
            evt.preventDefault();
            $scope.model.value = _.reject($scope.model.value, function (x) {
                return x.value === item.value && x.label === item.label;
            });
        };
        $scope.add = function (evt) {
            evt.preventDefault();
            if ($scope.newColor) {
                var newLabel = validLabel($scope.newLabel) ? $scope.newLabel : $scope.newColor;
                var exists = _.find($scope.model.value, function (item) {
                    return item.value.toUpperCase() === $scope.newColor.toUpperCase() || item.label.toUpperCase() === newLabel.toUpperCase();
                });
                if (!exists) {
                    $scope.model.value.push({
                        value: $scope.newColor,
                        label: newLabel
                    });
                    $scope.newLabel = '';
                    $scope.hasError = false;
                    $scope.focusOnNew = true;
                    return;
                }
                //there was an error, do the highlight (will be set back by the directive)
                $scope.hasError = true;
            }
        };
        $scope.sortableOptions = {
            axis: 'y',
            containment: 'parent',
            cursor: 'move',
            //handle: ".handle, .thumbnail",
            items: '> div.control-group',
            tolerance: 'pointer',
            update: function update(e, ui) {
                // Get the new and old index for the moved element (using the text as the identifier, so 
                // we'd have a problem if two prevalues were the same, but that would be unlikely)
                var newIndex = ui.item.index();
                var movedPrevalueText = $('pre', ui.item).text();
                var originalIndex = getElementIndexByPrevalueText(movedPrevalueText);
                //// Move the element in the model
                if (originalIndex > -1) {
                    var movedElement = $scope.model.value[originalIndex];
                    $scope.model.value.splice(originalIndex, 1);
                    $scope.model.value.splice(newIndex, 0, movedElement);
                }
            }
        };
        function getElementIndexByPrevalueText(value) {
            for (var i = 0; i < $scope.model.value.length; i++) {
                if ($scope.model.value[i].value === value) {
                    return i;
                }
            }
            return -1;
        }
        //load the separate css for the editor to avoid it blocking our js loading
        assetsService.loadCss('lib/spectrum/spectrum.css', $scope);
    });
    'use strict';
    /**
 * The controller that is used for a couple different Property Editors: Multi Node Tree Picker, Content Picker,
 * since this is used by MNTP and it supports content, media and members, there is code to deal with all 3 of those types
 * @param {any} $scope
 * @param {any} entityResource
 * @param {any} editorState
 * @param {any} iconHelper
 * @param {any} $routeParams
 * @param {any} angularHelper
 * @param {any} navigationService
 * @param {any} $location
 * @param {any} localizationService
 */
    function contentPickerController($scope, entityResource, editorState, iconHelper, $routeParams, angularHelper, navigationService, $location, localizationService, editorService, $q) {
        var unsubscribe;
        function subscribe() {
            unsubscribe = $scope.$on('formSubmitting', function (ev, args) {
                var currIds = _.map($scope.renderModel, function (i) {
                    return $scope.model.config.idType === 'udi' ? i.udi : i.id;
                });
                $scope.model.value = trim(currIds.join(), ',');
            });
        }
        function trim(str, chr) {
            var rgxtrim = !chr ? new RegExp('^\\s+|\\s+$', 'g') : new RegExp('^' + chr + '+|' + chr + '+$', 'g');
            return str.replace(rgxtrim, '');
        }
        /** Performs validation based on the renderModel data */
        function validate() {
            if ($scope.contentPickerForm) {
                angularHelper.getCurrentForm($scope).$setDirty();
                //Validate!
                if ($scope.model.config && $scope.model.config.minNumber && parseInt($scope.model.config.minNumber) > $scope.renderModel.length) {
                    $scope.contentPickerForm.minCount.$setValidity('minCount', false);
                } else {
                    $scope.contentPickerForm.minCount.$setValidity('minCount', true);
                }
                if ($scope.model.config && $scope.model.config.maxNumber && parseInt($scope.model.config.maxNumber) < $scope.renderModel.length) {
                    $scope.contentPickerForm.maxCount.$setValidity('maxCount', false);
                } else {
                    $scope.contentPickerForm.maxCount.$setValidity('maxCount', true);
                }
            }
        }
        function startWatch() {
            //due to the way angular-sortable works, it needs to update a model, we don't want it to update renderModel since renderModel
            //is updated based on changes to model.value so if we bound angular-sortable to that and put a watch on it we'd end up in a
            //infinite loop. Instead we have a custom array model for angular-sortable and we'll watch that which we'll use to sync the model.value
            //which in turn will sync the renderModel.
            $scope.$watchCollection('sortableModel', function (newVal, oldVal) {
                $scope.model.value = newVal.join();
            });
            //if the underlying model changes, update the view model, this ensures that the view is always consistent with the underlying
            //model if it changes (i.e. based on server updates, or if used in split view, etc...)
            $scope.$watch('model.value', function (newVal, oldVal) {
                if (newVal !== oldVal) {
                    syncRenderModel();
                }
            });
        }
        $scope.renderModel = [];
        $scope.sortableModel = [];
        $scope.dialogEditor = editorState && editorState.current && editorState.current.isDialogEditor === true;
        //the default pre-values
        var defaultConfig = {
            multiPicker: false,
            showOpenButton: false,
            showEditButton: false,
            showPathOnHover: false,
            maxNumber: 1,
            minNumber: 0,
            startNode: {
                query: '',
                type: 'content',
                id: $scope.model.config.startNodeId ? $scope.model.config.startNodeId : -1    // get start node for simple Content Picker
            }
        };
        // sortable options
        $scope.sortableOptions = {
            axis: 'y',
            containment: 'parent',
            distance: 10,
            opacity: 0.7,
            tolerance: 'pointer',
            scroll: true,
            zIndex: 6000
        };
        if ($scope.model.config) {
            //merge the server config on top of the default config, then set the server config to use the result
            $scope.model.config = angular.extend(defaultConfig, $scope.model.config);
        }
        //Umbraco persists boolean for prevalues as "0" or "1" so we need to convert that!
        $scope.model.config.multiPicker = Object.toBoolean($scope.model.config.multiPicker);
        $scope.model.config.showOpenButton = Object.toBoolean($scope.model.config.showOpenButton);
        $scope.model.config.showEditButton = Object.toBoolean($scope.model.config.showEditButton);
        $scope.model.config.showPathOnHover = Object.toBoolean($scope.model.config.showPathOnHover);
        var entityType = $scope.model.config.startNode.type === 'member' ? 'Member' : $scope.model.config.startNode.type === 'media' ? 'Media' : 'Document';
        $scope.allowOpenButton = entityType === 'Document';
        $scope.allowEditButton = entityType === 'Document';
        $scope.allowRemoveButton = true;
        //the dialog options for the picker
        var dialogOptions = {
            multiPicker: $scope.model.config.multiPicker,
            entityType: entityType,
            filterCssClass: 'not-allowed not-published',
            startNodeId: null,
            currentNode: editorState ? editorState.current : null,
            callback: function callback(data) {
                if (angular.isArray(data)) {
                    _.each(data, function (item, i) {
                        $scope.add(item);
                    });
                } else {
                    $scope.clear();
                    $scope.add(data);
                }
                angularHelper.getCurrentForm($scope).$setDirty();
            },
            treeAlias: $scope.model.config.startNode.type,
            section: $scope.model.config.startNode.type,
            idType: 'int',
            //only show the lang selector for content
            showLanguageSelector: $scope.model.config.startNode.type === 'content'
        };
        //since most of the pre-value config's are used in the dialog options (i.e. maxNumber, minNumber, etc...) we'll merge the 
        // pre-value config on to the dialog options
        angular.extend(dialogOptions, $scope.model.config);
        //We need to manually handle the filter for members here since the tree displayed is different and only contains
        // searchable list views
        if (entityType === 'Member') {
            //first change the not allowed filter css class
            dialogOptions.filterCssClass = 'not-allowed';
            var currFilter = dialogOptions.filter;
            //now change the filter to be a method
            dialogOptions.filter = function (i) {
                //filter out the list view nodes
                if (i.metaData.isContainer) {
                    return true;
                }
                if (!currFilter) {
                    return false;
                }
                //now we need to filter based on what is stored in the pre-vals, this logic duplicates what is in the treepicker.controller, 
                // but not much we can do about that since members require special filtering.
                var filterItem = currFilter.toLowerCase().split(',');
                var found = filterItem.indexOf(i.metaData.contentType.toLowerCase()) >= 0;
                if (!currFilter.startsWith('!') && !found || currFilter.startsWith('!') && found) {
                    return true;
                }
                return false;
            };
        }
        if ($routeParams.section === 'settings' && $routeParams.tree === 'documentTypes') {
            //if the content-picker is being rendered inside the document-type editor, we don't need to process the startnode query
            dialogOptions.startNodeId = -1;
        } else if ($scope.model.config.startNode.query) {
            //if we have a query for the startnode, we will use that.
            var rootId = $routeParams.id;
            entityResource.getByQuery($scope.model.config.startNode.query, rootId, 'Document').then(function (ent) {
                dialogOptions.startNodeId = $scope.model.config.idType === 'udi' ? ent.udi : ent.id;
            });
        } else {
            dialogOptions.startNodeId = $scope.model.config.startNode.id;
        }
        //dialog
        $scope.openContentPicker = function () {
            $scope.contentPicker = dialogOptions;
            $scope.contentPicker.submit = function (model) {
                if (angular.isArray(model.selection)) {
                    _.each(model.selection, function (item, i) {
                        $scope.add(item);
                    });
                    angularHelper.getCurrentForm($scope).$setDirty();
                }
                angularHelper.getCurrentForm($scope).$setDirty();
                editorService.close();
            };
            $scope.contentPicker.close = function () {
                editorService.close();
            };
            editorService.contentPicker($scope.contentPicker);
        };
        $scope.remove = function (index) {
            var currIds = $scope.model.value ? $scope.model.value.split(',') : [];
            if (currIds.length > 0) {
                currIds.splice(index, 1);
                angularHelper.getCurrentForm($scope).$setDirty();
                $scope.model.value = currIds.join();
            }
        };
        $scope.showNode = function (index) {
            var item = $scope.renderModel[index];
            var id = item.id;
            var section = $scope.model.config.startNode.type.toLowerCase();
            entityResource.getPath(id, entityType).then(function (path) {
                navigationService.changeSection(section);
                navigationService.showTree(section, {
                    tree: section,
                    path: path,
                    forceReload: false,
                    activate: true
                });
                var routePath = section + '/' + section + '/edit/' + id.toString();
                $location.path(routePath).search('');
            });
        };
        $scope.add = function (item) {
            var currIds = $scope.model.value ? $scope.model.value.split(',') : [];
            var itemId = $scope.model.config.idType === 'udi' ? item.udi : item.id;
            if (currIds.indexOf(itemId) < 0) {
                currIds.push(itemId);
                $scope.model.value = currIds.join();
            }
        };
        $scope.clear = function () {
            $scope.model.value = null;
        };
        $scope.openContentEditor = function (node) {
            var contentEditor = {
                id: node.id,
                submit: function submit(model) {
                    // update the node
                    node.name = model.contentNode.name;
                    node.published = model.contentNode.hasPublishedVersion;
                    if (entityType !== 'Member') {
                        entityResource.getUrl(model.contentNode.id, entityType).then(function (data) {
                            node.url = data;
                        });
                    }
                    editorService.close();
                },
                close: function close() {
                    editorService.close();
                }
            };
            editorService.contentEditor(contentEditor);
        };
        //when the scope is destroyed we need to unsubscribe
        $scope.$on('$destroy', function () {
            if (unsubscribe) {
                unsubscribe();
            }
        });
        /** Syncs the renderModel based on the actual model.value and returns a promise */
        function syncRenderModel(doValidation) {
            var valueIds = $scope.model.value ? $scope.model.value.split(',') : [];
            //sync the sortable model
            $scope.sortableModel = valueIds;
            //load current data if anything selected
            if (valueIds.length > 0) {
                //need to determine which items we already have loaded
                var renderModelIds = _.map($scope.renderModel, function (d) {
                    return $scope.model.config.idType === 'udi' ? d.udi : d.id;
                });
                //get the ids that no longer exist
                var toRemove = _.difference(renderModelIds, valueIds);
                //remove the ones that no longer exist
                for (var j = 0; j < toRemove.length; j++) {
                    var index = renderModelIds.indexOf(toRemove[j]);
                    $scope.renderModel.splice(index, 1);
                }
                //get the ids that we need to lookup entities for
                var missingIds = _.difference(valueIds, renderModelIds);
                if (missingIds.length > 0) {
                    return entityResource.getByIds(missingIds, entityType).then(function (data) {
                        _.each(valueIds, function (id, i) {
                            var entity = _.find(data, function (d) {
                                return $scope.model.config.idType === 'udi' ? d.udi == id : d.id == id;
                            });
                            if (entity) {
                                addSelectedItem(entity);
                            }
                        });
                        if (doValidation) {
                            validate();
                        }
                        setSortingState($scope.renderModel);
                        return $q.when(true);
                    });
                } else {
                    //if there's nothing missing, make sure it's sorted correctly
                    var current = $scope.renderModel;
                    $scope.renderModel = [];
                    for (var k = 0; k < valueIds.length; k++) {
                        var id = valueIds[k];
                        var found = _.find(current, function (d) {
                            return $scope.model.config.idType === 'udi' ? d.udi == id : d.id == id;
                        });
                        if (found) {
                            $scope.renderModel.push(found);
                        }
                    }
                    if (doValidation) {
                        validate();
                    }
                    setSortingState($scope.renderModel);
                    return $q.when(true);
                }
            } else {
                $scope.renderModel = [];
                if (validate) {
                    validate();
                }
                setSortingState($scope.renderModel);
                return $q.when(true);
            }
        }
        function setEntityUrl(entity) {
            // get url for content and media items
            if (entityType !== 'Member') {
                entityResource.getUrl(entity.id, entityType).then(function (data) {
                    // update url                
                    angular.forEach($scope.renderModel, function (item) {
                        if (item.id === entity.id) {
                            if (entity.trashed) {
                                item.url = localizationService.dictionary.general_recycleBin;
                            } else {
                                item.url = data;
                            }
                        }
                    });
                });
            }
        }
        function addSelectedItem(item) {
            // set icon
            if (item.icon) {
                item.icon = iconHelper.convertFromLegacyIcon(item.icon);
            }
            // set default icon
            if (!item.icon) {
                switch (entityType) {
                case 'Document':
                    item.icon = 'icon-document';
                    break;
                case 'Media':
                    item.icon = 'icon-picture';
                    break;
                case 'Member':
                    item.icon = 'icon-user';
                    break;
                }
            }
            $scope.renderModel.push({
                'name': item.name,
                'id': item.id,
                'udi': item.udi,
                'icon': item.icon,
                'path': item.path,
                'url': item.url,
                'trashed': item.trashed,
                'published': item.metaData && item.metaData.IsPublished === false && entityType === 'Document' ? false : true    // only content supports published/unpublished content so we set everything else to published so the UI looks correct 
            });
            setEntityUrl(item);
        }
        function setSortingState(items) {
            // disable sorting if the list only consist of one item
            if (items.length > 1) {
                $scope.sortableOptions.disabled = false;
            } else {
                $scope.sortableOptions.disabled = true;
            }
        }
        function init() {
            syncRenderModel(false).then(function () {
                //everything is loaded, start the watch on the model
                startWatch();
                subscribe();
            });
        }
        init();
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.ContentPickerController', contentPickerController);
    'use strict';
    function dateTimePickerController($scope, notificationsService, assetsService, angularHelper, userService, $element, dateHelper) {
        var flatPickr = null;
        function onInit() {
            $scope.hasDatetimePickerValue = $scope.model.value ? true : false;
            $scope.model.datetimePickerValue = null;
            $scope.serverTime = null;
            $scope.serverTimeNeedsOffsetting = false;
            // setup the default config
            var config = {
                pickDate: true,
                pickTime: true,
                useSeconds: true,
                format: 'YYYY-MM-DD HH:mm:ss',
                icons: {
                    time: 'icon-time',
                    date: 'icon-calendar',
                    up: 'icon-chevron-up',
                    down: 'icon-chevron-down'
                }
            };
            // map the user config
            $scope.model.config = angular.extend(config, $scope.model.config);
            // ensure the format doesn't get overwritten with an empty string
            if ($scope.model.config.format === '' || $scope.model.config.format === undefined || $scope.model.config.format === null) {
                $scope.model.config.format = $scope.model.config.pickTime ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD';
            }
            // check whether a server time offset is needed
            if (Umbraco.Sys.ServerVariables.application.serverTimeOffset !== undefined) {
                // Will return something like 120
                var serverOffset = Umbraco.Sys.ServerVariables.application.serverTimeOffset;
                // Will return something like -120
                var localOffset = new Date().getTimezoneOffset();
                // If these aren't equal then offsetting is needed
                // note the minus in front of serverOffset needed 
                // because C# and javascript return the inverse offset
                $scope.serverTimeNeedsOffsetting = -serverOffset !== localOffset;
            }
            var dateFormat = $scope.model.config.pickTime ? 'Y-m-d H:i:S' : 'Y-m-d';
            // date picker config
            $scope.datePickerConfig = {
                enableTime: $scope.model.config.pickTime,
                dateFormat: dateFormat,
                time_24hr: true
            };
            setDatePickerVal();
        }
        $scope.clearDate = function () {
            $scope.hasDatetimePickerValue = false;
            if ($scope.model) {
                $scope.model.datetimePickerValue = null;
                $scope.model.value = null;
            }
            if ($scope.datePickerForm && $scope.datePickerForm.datepicker) {
                $scope.datePickerForm.datepicker.$setValidity('pickerError', true);
            }
        };
        $scope.datePickerSetup = function (instance) {
            flatPickr = instance;
        };
        $scope.datePickerChange = function (date) {
            setDate(date);
            setDatePickerVal();
        };
        //here we declare a special method which will be called whenever the value has changed from the server
        //this is instead of doing a watch on the model.value = faster
        $scope.model.onValueChanged = function (newVal, oldVal) {
            if (newVal != oldVal) {
                //check for c# System.DateTime.MinValue being passed as the clear indicator
                var minDate = moment('0001-01-01');
                var newDate = moment(newVal);
                if (newDate.isAfter(minDate)) {
                    setDate(newVal);
                } else {
                    $scope.clearDate();
                }
            }
        };
        function setDate(date) {
            var momentDate = moment(date);
            angularHelper.safeApply($scope, function () {
                // when a date is changed, update the model
                if (momentDate && momentDate.isValid()) {
                    $scope.datePickerForm.datepicker.$setValidity('pickerError', true);
                    $scope.hasDatetimePickerValue = true;
                    $scope.model.datetimePickerValue = momentDate.format($scope.model.config.format);
                } else {
                    $scope.hasDatetimePickerValue = false;
                    $scope.model.datetimePickerValue = null;
                }
                updateModelValue(date);
            });
        }
        function updateModelValue(date) {
            var momentDate = moment(date);
            if ($scope.hasDatetimePickerValue) {
                if ($scope.model.config.pickTime) {
                    //check if we are supposed to offset the time
                    if ($scope.model.value && Object.toBoolean($scope.model.config.offsetTime) && Umbraco.Sys.ServerVariables.application.serverTimeOffset !== undefined) {
                        $scope.model.value = dateHelper.convertToServerStringTime(momentDate, Umbraco.Sys.ServerVariables.application.serverTimeOffset);
                        $scope.serverTime = dateHelper.convertToServerStringTime(momentDate, Umbraco.Sys.ServerVariables.application.serverTimeOffset, 'YYYY-MM-DD HH:mm:ss Z');
                    } else {
                        $scope.model.value = momentDate.format('YYYY-MM-DD HH:mm:ss');
                    }
                } else {
                    $scope.model.value = momentDate.format('YYYY-MM-DD');
                }
            } else {
                $scope.model.value = null;
            }
            angularHelper.getCurrentForm($scope).$setDirty();
        }
        /** Sets the value of the date picker control adn associated viewModel objects based on the model value */
        function setDatePickerVal() {
            if ($scope.model.value) {
                var dateVal;
                //check if we are supposed to offset the time
                if ($scope.model.value && Object.toBoolean($scope.model.config.offsetTime) && $scope.serverTimeNeedsOffsetting) {
                    //get the local time offset from the server
                    dateVal = dateHelper.convertToLocalMomentTime($scope.model.value, Umbraco.Sys.ServerVariables.application.serverTimeOffset);
                    $scope.serverTime = dateHelper.convertToServerStringTime(dateVal, Umbraco.Sys.ServerVariables.application.serverTimeOffset, 'YYYY-MM-DD HH:mm:ss Z');
                } else {
                    //create a normal moment , no offset required
                    var dateVal = $scope.model.value ? moment($scope.model.value, 'YYYY-MM-DD HH:mm:ss') : moment();
                }
                $scope.model.datetimePickerValue = dateVal.format($scope.model.config.format);
            } else {
                $scope.clearDate();
            }
        }
        $scope.$watch('model.value', function (newVal, oldVal) {
            if (newVal !== oldVal) {
                $scope.hasDatetimePickerValue = newVal ? true : false;
                setDatePickerVal();
            }
        });
        onInit();
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.DatepickerController', dateTimePickerController);
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.DropdownFlexibleController', function ($scope) {
        //setup the default config
        var config = {
            items: [],
            multiple: false
        };
        //map the user config
        angular.extend(config, $scope.model.config);
        //map back to the model
        $scope.model.config = config;
        //ensure this is a bool, old data could store zeros/ones or string versions
        $scope.model.config.multiple = Object.toBoolean($scope.model.config.multiple);
        function convertArrayToDictionaryArray(model) {
            //now we need to format the items in the dictionary because we always want to have an array
            var newItems = [];
            for (var i = 0; i < model.length; i++) {
                newItems.push({
                    id: model[i],
                    sortOrder: 0,
                    value: model[i]
                });
            }
            return newItems;
        }
        function convertObjectToDictionaryArray(model) {
            //now we need to format the items in the dictionary because we always want to have an array
            var newItems = [];
            var vals = _.values($scope.model.config.items);
            var keys = _.keys($scope.model.config.items);
            for (var i = 0; i < vals.length; i++) {
                var label = vals[i].value ? vals[i].value : vals[i];
                newItems.push({
                    id: keys[i],
                    sortOrder: vals[i].sortOrder,
                    value: label
                });
            }
            return newItems;
        }
        $scope.updateSingleDropdownValue = function () {
            $scope.model.value = [$scope.model.singleDropdownValue];
        };
        if (angular.isArray($scope.model.config.items)) {
            //PP: I dont think this will happen, but we have tests that expect it to happen..
            //if array is simple values, convert to array of objects
            if (!angular.isObject($scope.model.config.items[0])) {
                $scope.model.config.items = convertArrayToDictionaryArray($scope.model.config.items);
            }
        } else if (angular.isObject($scope.model.config.items)) {
            $scope.model.config.items = convertObjectToDictionaryArray($scope.model.config.items);
        } else {
            throw 'The items property must be either an array or a dictionary';
        }
        //sort the values
        $scope.model.config.items.sort(function (a, b) {
            return a.sortOrder > b.sortOrder ? 1 : b.sortOrder > a.sortOrder ? -1 : 0;
        });
        //now we need to check if the value is null/undefined, if it is we need to set it to "" so that any value that is set
        // to "" gets selected by default
        if ($scope.model.value === null || $scope.model.value === undefined) {
            if ($scope.model.config.multiple) {
                $scope.model.value = [];
            } else {
                $scope.model.value = '';
            }
        }
        // if we run in single mode we'll store the value in a local variable
        // so we can pass an array as the model as our PropertyValueEditor expects that
        $scope.model.singleDropdownValue = '';
        if (!Object.toBoolean($scope.model.config.multiple) && $scope.model.value) {
            $scope.model.singleDropdownValue = Array.isArray($scope.model.value) ? $scope.model.value[0] : $scope.model.value;
        }
        // if we run in multiple mode, make sure the model is an array (in case the property was previously saved in single mode)
        // also explicitly set the model to null if it's an empty array, so mandatory validation works on the client
        if ($scope.model.config.multiple === '1' && $scope.model.value) {
            $scope.model.value = !Array.isArray($scope.model.value) ? [$scope.model.value] : $scope.model.value;
            if ($scope.model.value.length === 0) {
                $scope.model.value = null;
            }
        }
    });
    'use strict';
    /** A drop down list or multi value select list based on an entity type, this can be re-used for any entity types */
    function entityPicker($scope, entityResource) {
        //set the default to DocumentType
        if (!$scope.model.config.entityType) {
            $scope.model.config.entityType = 'DocumentType';
        }
        //Determine the select list options and which value to publish
        if (!$scope.model.config.publishBy) {
            $scope.selectOptions = 'entity.id as entity.name for entity in entities';
        } else {
            $scope.selectOptions = 'entity.' + $scope.model.config.publishBy + ' as entity.name for entity in entities';
        }
        entityResource.getAll($scope.model.config.entityType).then(function (data) {
            //convert the ids to strings so the drop downs work properly when comparing
            _.each(data, function (d) {
                d.id = d.id.toString();
            });
            $scope.entities = data;
        });
        if ($scope.model.value === null || $scope.model.value === undefined) {
            if ($scope.model.config.multiple) {
                $scope.model.value = [];
            } else {
                $scope.model.value = '';
            }
        } else {
            //if it's multiple, change the value to an array
            if (Object.toBoolean($scope.model.config.multiple)) {
                if (_.isString($scope.model.value)) {
                    $scope.model.value = $scope.model.value.split(',');
                }
            }
        }
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.EntityPickerController', entityPicker);
    'use strict';
    (function () {
        'use strict';
        /**
   * @ngdoc controller
   * @name Umbraco.Editors.FileUploadController
   * @function
   *
   * @description
   * The controller for the file upload property editor.
   *
  */
        function fileUploadController($scope, fileManager) {
            $scope.fileChanged = onFileChanged;
            //declare a special method which will be called whenever the value has changed from the server
            $scope.model.onValueChanged = onValueChanged;
            /**
     * Called when the file selection value changes
     * @param {any} value
     */
            function onFileChanged(value) {
                $scope.model.value = value;
            }
            /**
     * called whenever the value has changed from the server
     * @param {any} newVal
     * @param {any} oldVal
     */
            function onValueChanged(newVal, oldVal) {
                //clear current uploaded files
                fileManager.setFiles({
                    propertyAlias: $scope.model.alias,
                    culture: $scope.model.culture,
                    files: []
                });
            }
        }
        ;
        angular.module('umbraco').controller('Umbraco.PropertyEditors.FileUploadController', fileUploadController).run(function (mediaHelper, umbRequestHelper, assetsService) {
            if (mediaHelper && mediaHelper.registerFileResolver) {
                //NOTE: The 'entity' can be either a normal media entity or an "entity" returned from the entityResource
                // they contain different data structures so if we need to query against it we need to be aware of this.
                mediaHelper.registerFileResolver('Umbraco.UploadField', function (property, entity, thumbnail) {
                    if (thumbnail) {
                        if (mediaHelper.detectIfImageByExtension(property.value)) {
                            //get default big thumbnail from image processor
                            var thumbnailUrl = property.value + '?rnd=' + moment(entity.updateDate).format('YYYYMMDDHHmmss') + '&width=500&animationprocessmode=first';
                            return thumbnailUrl;
                        } else {
                            return null;
                        }
                    } else {
                        return property.value;
                    }
                });
            }
        });
    }());
    'use strict';
    angular.module('umbraco')    //this controller is obsolete and should not be used anymore
                                 //it proxies everything to the system media list view which has overtaken
                                 //all the work this property editor used to perform
.controller('Umbraco.PropertyEditors.FolderBrowserController', function ($rootScope, $scope, contentTypeResource) {
        //get the system media listview
        contentTypeResource.getPropertyTypeScaffold(-96).then(function (dt) {
            $scope.fakeProperty = {
                alias: 'contents',
                config: dt.config,
                description: '',
                editor: dt.editor,
                hideLabel: true,
                id: 1,
                label: 'Contents:',
                validation: {
                    mandatory: false,
                    pattern: null
                },
                value: '',
                view: dt.view
            };
        });
    });
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.GridPrevalueEditor.LayoutConfigController', function ($scope) {
        $scope.currentLayout = $scope.model.currentLayout;
        $scope.columns = $scope.model.columns;
        $scope.rows = $scope.model.rows;
        $scope.scaleUp = function (section, max, overflow) {
            var add = 1;
            if (overflow !== true) {
                add = max > 1 ? 1 : max;
            }
            //var add = (max > 1) ? 1 : max;
            section.grid = section.grid + add;
        };
        $scope.scaleDown = function (section) {
            var remove = section.grid > 1 ? 1 : 0;
            section.grid = section.grid - remove;
        };
        $scope.percentage = function (spans) {
            return (spans / $scope.columns * 100).toFixed(8);
        };
        /****************
      Section
  *****************/
        $scope.configureSection = function (section, template) {
            if (section === undefined) {
                var space = $scope.availableLayoutSpace > 4 ? 4 : $scope.availableLayoutSpace;
                section = { grid: space };
                template.sections.push(section);
            }
            $scope.currentSection = section;
            $scope.currentSection.allowAll = section.allowAll || !section.allowed || !section.allowed.length;
        };
        $scope.toggleAllowed = function (section) {
            if (section.allowed) {
                delete section.allowed;
            } else {
                section.allowed = [];
            }
        };
        $scope.deleteSection = function (section, template) {
            if ($scope.currentSection === section) {
                $scope.currentSection = undefined;
            }
            var index = template.sections.indexOf(section);
            template.sections.splice(index, 1);
        };
        $scope.closeSection = function () {
            $scope.currentSection = undefined;
        };
        $scope.$watch('currentLayout', function (layout) {
            if (layout) {
                var total = 0;
                _.forEach(layout.sections, function (section) {
                    total = total + section.grid;
                });
                $scope.availableLayoutSpace = $scope.columns - total;
            }
        }, true);
    });
    'use strict';
    function RowConfigController($scope) {
        $scope.currentRow = $scope.model.currentRow;
        $scope.editors = $scope.model.editors;
        $scope.columns = $scope.model.columns;
        $scope.scaleUp = function (section, max, overflow) {
            var add = 1;
            if (overflow !== true) {
                add = max > 1 ? 1 : max;
            }
            //var add = (max > 1) ? 1 : max;
            section.grid = section.grid + add;
        };
        $scope.scaleDown = function (section) {
            var remove = section.grid > 1 ? 1 : 0;
            section.grid = section.grid - remove;
        };
        $scope.percentage = function (spans) {
            return (spans / $scope.columns * 100).toFixed(8);
        };
        /****************
      area
  *****************/
        $scope.configureCell = function (cell, row) {
            if ($scope.currentCell && $scope.currentCell === cell) {
                delete $scope.currentCell;
            } else {
                if (cell === undefined) {
                    var available = $scope.availableRowSpace;
                    var space = 4;
                    if (available < 4 && available > 0) {
                        space = available;
                    }
                    cell = { grid: space };
                    row.areas.push(cell);
                }
                $scope.currentCell = cell;
                $scope.currentCell.allowAll = cell.allowAll || !cell.allowed || !cell.allowed.length;
            }
        };
        $scope.toggleAllowed = function (cell) {
            if (cell.allowed) {
                delete cell.allowed;
            } else {
                cell.allowed = [];
            }
        };
        $scope.deleteArea = function (cell, row) {
            if ($scope.currentCell === cell) {
                $scope.currentCell = undefined;
            }
            var index = row.areas.indexOf(cell);
            row.areas.splice(index, 1);
        };
        $scope.closeArea = function () {
            $scope.currentCell = undefined;
        };
        $scope.nameChanged = false;
        var originalName = $scope.currentRow.name;
        $scope.$watch('currentRow', function (row) {
            if (row) {
                var total = 0;
                _.forEach(row.areas, function (area) {
                    total = total + area.grid;
                });
                $scope.availableRowSpace = $scope.columns - total;
                if (originalName) {
                    if (originalName != row.name) {
                        $scope.nameChanged = true;
                    } else {
                        $scope.nameChanged = false;
                    }
                }
            }
        }, true);
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.GridPrevalueEditor.RowConfigController', RowConfigController);
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.Grid.EmbedController', function ($scope, $timeout, $sce, editorService) {
        function onInit() {
            $scope.trustedValue = null;
            $scope.trustedValue = $sce.trustAsHtml($scope.control.value);
            if (!$scope.control.value) {
                $timeout(function () {
                    if ($scope.control.$initializing) {
                        $scope.setEmbed();
                    }
                }, 200);
            }
        }
        $scope.setEmbed = function () {
            var embed = {
                submit: function submit(model) {
                    $scope.control.value = model.embed.preview;
                    $scope.trustedValue = $sce.trustAsHtml(model.embed.preview);
                    editorService.close();
                },
                close: function close() {
                    editorService.close();
                }
            };
            editorService.embed(embed);
        };
        onInit();
    });
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.Grid.MacroController', function ($scope, $timeout, editorService, macroResource, macroService, $routeParams) {
        $scope.title = 'Click to insert macro';
        $scope.setMacro = function () {
            var dialogData = {
                richTextEditor: true,
                macroData: $scope.control.value || { macroAlias: $scope.control.editor.config && $scope.control.editor.config.macroAlias ? $scope.control.editor.config.macroAlias : '' }
            };
            var macroPicker = {
                dialogData: dialogData,
                submit: function submit(model) {
                    var macroObject = macroService.collectValueData(model.selectedMacro, model.macroParams, dialogData.renderingEngine);
                    $scope.control.value = {
                        macroAlias: macroObject.macroAlias,
                        macroParamsDictionary: macroObject.macroParamsDictionary
                    };
                    $scope.setPreview($scope.control.value);
                    editorService.close();
                },
                close: function close() {
                    editorService.close();
                }
            };
            editorService.macroPicker(macroPicker);
        };
        $scope.setPreview = function (macro) {
            var contentId = $routeParams.id;
            macroResource.getMacroResultAsHtmlForEditor(macro.macroAlias, contentId, macro.macroParamsDictionary).then(function (htmlResult) {
                $scope.title = macro.macroAlias;
                if (htmlResult.trim().length > 0 && htmlResult.indexOf('Macro:') < 0) {
                    $scope.preview = htmlResult;
                }
            });
        };
        $timeout(function () {
            if ($scope.control.$initializing) {
                $scope.setMacro();
            } else if ($scope.control.value) {
                $scope.setPreview($scope.control.value);
            }
        }, 200);
    });
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.Grid.MediaController', function ($scope, $timeout, userService, editorService) {
        if (!$scope.model.config.startNodeId) {
            userService.getCurrentUser().then(function (userData) {
                $scope.model.config.startNodeId = userData.startMediaIds.length !== 1 ? -1 : userData.startMediaIds[0];
                $scope.model.config.startNodeIsVirtual = userData.startMediaIds.length !== 1;
            });
        }
        function onInit() {
            if ($scope.control.value) {
                $scope.setUrl();
            }
        }
        $scope.setImage = function () {
            var startNodeId = $scope.model.config && $scope.model.config.startNodeId ? $scope.model.config.startNodeId : undefined;
            var startNodeIsVirtual = startNodeId ? $scope.model.config.startNodeIsVirtual : undefined;
            var mediaPicker = {
                startNodeId: startNodeId,
                startNodeIsVirtual: startNodeIsVirtual,
                cropSize: $scope.control.editor.config && $scope.control.editor.config.size ? $scope.control.editor.config.size : undefined,
                showDetails: true,
                disableFolderSelect: true,
                onlyImages: true,
                submit: function submit(model) {
                    var selectedImage = model.selectedImages[0];
                    $scope.control.value = {
                        focalPoint: selectedImage.focalPoint,
                        id: selectedImage.id,
                        udi: selectedImage.udi,
                        image: selectedImage.image,
                        altText: selectedImage.altText
                    };
                    $scope.setUrl();
                    editorService.close();
                },
                close: function close() {
                    editorService.close();
                }
            };
            editorService.mediaPicker(mediaPicker);
        };
        $scope.setUrl = function () {
            if ($scope.control.value.image) {
                var url = $scope.control.value.image;
                if ($scope.control.editor.config && $scope.control.editor.config.size) {
                    url += '?width=' + $scope.control.editor.config.size.width;
                    url += '&height=' + $scope.control.editor.config.size.height;
                    url += '&animationprocessmode=first';
                    if ($scope.control.value.focalPoint) {
                        url += '&center=' + $scope.control.value.focalPoint.top + ',' + $scope.control.value.focalPoint.left;
                        url += '&mode=crop';
                    }
                }
                // set default size if no crop present (moved from the view)
                if (url.indexOf('?') == -1) {
                    url += '?width=800&upscale=false&animationprocessmode=false';
                }
                $scope.url = url;
            }
        };
        onInit();
    });
    'use strict';
    (function () {
        'use strict';
        function GridRichTextEditorController() {
            var vm = this;
        }
        angular.module('umbraco').controller('Umbraco.PropertyEditors.Grid.RichTextEditorController', GridRichTextEditorController);
    }());
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.Grid.TextStringController', function () {
    });
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.GridController', function ($scope, localizationService, gridService, $timeout, umbRequestHelper, angularHelper, $element, eventsService) {
        // Grid status variables
        var placeHolder = '';
        var currentForm = angularHelper.getCurrentForm($scope);
        $scope.currentRow = null;
        $scope.currentCell = null;
        $scope.currentToolsControl = null;
        $scope.currentControl = null;
        $scope.openRTEToolbarId = null;
        $scope.hasSettings = false;
        $scope.showRowConfigurations = true;
        $scope.sortMode = false;
        $scope.reorderKey = 'general_reorder';
        // *********************************************
        // Sortable options
        // *********************************************
        var draggedRteSettings;
        $scope.sortableOptionsRow = {
            distance: 10,
            cursor: 'move',
            placeholder: 'ui-sortable-placeholder',
            handle: '.umb-row-title-bar',
            helper: 'clone',
            forcePlaceholderSize: true,
            tolerance: 'pointer',
            zIndex: 1000000000000000000,
            scrollSensitivity: 100,
            cursorAt: {
                top: 40,
                left: 60
            },
            sort: function sort(event, ui) {
                /* prevent vertical scroll out of the screen */
                var max = $('.umb-grid').width() - 150;
                if (parseInt(ui.helper.css('left')) > max) {
                    ui.helper.css({ 'left': max + 'px' });
                }
                if (parseInt(ui.helper.css('left')) < 20) {
                    ui.helper.css({ 'left': 20 });
                }
            },
            start: function start(e, ui) {
                // Fade out row when sorting
                ui.item.context.style.display = 'block';
                ui.item.context.style.opacity = '0.5';
                draggedRteSettings = {};
                ui.item.find('.mceNoEditor').each(function () {
                    // remove all RTEs in the dragged row and save their settings
                    var id = $(this).attr('id');
                    draggedRteSettings[id] = _.findWhere(tinyMCE.editors, { id: id }).settings;    // tinyMCE.execCommand("mceRemoveEditor", false, id);
                });
            },
            stop: function stop(e, ui) {
                // Fade in row when sorting stops
                ui.item.context.style.opacity = '1';
                // reset all RTEs affected by the dragging
                ui.item.parents('.umb-column').find('.mceNoEditor').each(function () {
                    var id = $(this).attr('id');
                    draggedRteSettings[id] = draggedRteSettings[id] || _.findWhere(tinyMCE.editors, { id: id }).settings;
                    tinyMCE.execCommand('mceRemoveEditor', false, id);
                    tinyMCE.init(draggedRteSettings[id]);
                });
                currentForm.$setDirty();
            }
        };
        var notIncludedRte = [];
        var cancelMove = false;
        var startingArea;
        $scope.sortableOptionsCell = {
            distance: 10,
            cursor: 'move',
            placeholder: 'ui-sortable-placeholder',
            handle: '.umb-control-handle',
            helper: 'clone',
            connectWith: '.umb-cell-inner',
            forcePlaceholderSize: true,
            tolerance: 'pointer',
            zIndex: 1000000000000000000,
            scrollSensitivity: 100,
            cursorAt: {
                top: 45,
                left: 90
            },
            sort: function sort(event, ui) {
                /* prevent vertical scroll out of the screen */
                var position = parseInt(ui.item.parent().offset().left) + parseInt(ui.helper.css('left')) - parseInt($('.umb-grid').offset().left);
                var max = $('.umb-grid').width() - 220;
                if (position > max) {
                    ui.helper.css({ 'left': max - parseInt(ui.item.parent().offset().left) + parseInt($('.umb-grid').offset().left) + 'px' });
                }
                if (position < 0) {
                    ui.helper.css({ 'left': 0 - parseInt(ui.item.parent().offset().left) + parseInt($('.umb-grid').offset().left) + 'px' });
                }
            },
            over: function over(event, ui) {
                var area = $(event.target).scope().area;
                var allowedEditors = area.allowed;
                if ($.inArray(ui.item.scope().control.editor.alias, allowedEditors) < 0 && allowedEditors || startingArea != area && area.maxItems != '' && area.maxItems > 0 && area.maxItems < area.controls.length + 1) {
                    $scope.$apply(function () {
                        $(event.target).scope().area.dropNotAllowed = true;
                    });
                    ui.placeholder.hide();
                    cancelMove = true;
                } else {
                    if ($(event.target).scope().area.controls.length == 0) {
                        $scope.$apply(function () {
                            $(event.target).scope().area.dropOnEmpty = true;
                        });
                        ui.placeholder.hide();
                    } else {
                        ui.placeholder.show();
                    }
                    cancelMove = false;
                }
            },
            out: function out(event, ui) {
                $scope.$apply(function () {
                    $(event.target).scope().area.dropNotAllowed = false;
                    $(event.target).scope().area.dropOnEmpty = false;
                });
            },
            update: function update(event, ui) {
                /* add all RTEs which are affected by the dragging */
                if (!ui.sender) {
                    if (cancelMove) {
                        ui.item.sortable.cancel();
                    }
                    ui.item.parents('.umb-cell.content').find('.mceNoEditor').each(function () {
                        if ($.inArray($(this).attr('id'), notIncludedRte) < 0) {
                            notIncludedRte.splice(0, 0, $(this).attr('id'));
                        }
                    });
                } else {
                    $(event.target).find('.mceNoEditor').each(function () {
                        if ($.inArray($(this).attr('id'), notIncludedRte) < 0) {
                            notIncludedRte.splice(0, 0, $(this).attr('id'));
                        }
                    });
                }
                currentForm.$setDirty();
            },
            start: function start(e, ui) {
                //Get the starting area for reference
                var area = $(e.target).scope().area;
                startingArea = area;
                // fade out control when sorting
                ui.item.context.style.display = 'block';
                ui.item.context.style.opacity = '0.5';
                // reset dragged RTE settings in case a RTE isn't dragged
                draggedRteSettings = undefined;
                ui.item.context.style.display = 'block';
                ui.item.find('.mceNoEditor').each(function () {
                    notIncludedRte = [];
                    var editors = _.findWhere(tinyMCE.editors, { id: $(this).attr('id') });
                    // save the dragged RTE settings
                    if (editors) {
                        draggedRteSettings = editors.settings;
                        // remove the dragged RTE
                        tinyMCE.execCommand('mceRemoveEditor', false, $(this).attr('id'));
                    }
                });
            },
            stop: function stop(e, ui) {
                // Fade in control when sorting stops
                ui.item.context.style.opacity = '1';
                ui.item.offsetParent().find('.mceNoEditor').each(function () {
                    if ($.inArray($(this).attr('id'), notIncludedRte) < 0) {
                        // add all dragged's neighbouring RTEs in the new cell
                        notIncludedRte.splice(0, 0, $(this).attr('id'));
                    }
                });
                $timeout(function () {
                    // reconstruct the dragged RTE (could be undefined when dragging something else than RTE)
                    if (draggedRteSettings !== undefined) {
                        tinyMCE.init(draggedRteSettings);
                    }
                    _.forEach(notIncludedRte, function (id) {
                        // reset all the other RTEs
                        if (draggedRteSettings === undefined || id !== draggedRteSettings.id) {
                            var rteSettings = _.findWhere(tinyMCE.editors, { id: id }).settings;
                            tinyMCE.execCommand('mceRemoveEditor', false, id);
                            tinyMCE.init(rteSettings);
                        }
                    });
                }, 500, false);
                $scope.$apply(function () {
                    var cell = $(e.target).scope().area;
                    cell.hasActiveChild = hasActiveChild(cell, cell.controls);
                    cell.active = false;
                });
            }
        };
        $scope.toggleSortMode = function () {
            $scope.sortMode = !$scope.sortMode;
            if ($scope.sortMode) {
                $scope.reorderKey = 'general_reorderDone';
            } else {
                $scope.reorderKey = 'general_reorder';
            }
        };
        $scope.showReorderButton = function () {
            if ($scope.model.value && $scope.model.value.sections) {
                for (var i = 0; $scope.model.value.sections.length > i; i++) {
                    var section = $scope.model.value.sections[i];
                    if (section.rows && section.rows.length > 0) {
                        return true;
                    }
                }
            }
        };
        // *********************************************
        // Add items overlay menu
        // *********************************************
        $scope.openEditorOverlay = function (event, area, index, key) {
            var title = '';
            localizationService.localize('grid_insertControl').then(function (value) {
                title = value;
                $scope.editorOverlay = {
                    view: 'itempicker',
                    filter: area.$allowedEditors.length > 15,
                    title: title,
                    availableItems: area.$allowedEditors,
                    event: event,
                    show: true,
                    submit: function submit(model) {
                        if (model.selectedItem) {
                            $scope.addControl(model.selectedItem, area, index);
                            $scope.editorOverlay.show = false;
                            $scope.editorOverlay = null;
                        }
                    }
                };
            });
        };
        // *********************************************
        // Template management functions
        // *********************************************
        $scope.addTemplate = function (template) {
            $scope.model.value = angular.copy(template);
            //default row data
            _.forEach($scope.model.value.sections, function (section) {
                $scope.initSection(section);
            });
        };
        // *********************************************
        // Row management function
        // *********************************************
        $scope.clickRow = function (index, rows) {
            rows[index].active = true;
        };
        $scope.clickOutsideRow = function (index, rows) {
            rows[index].active = false;
        };
        function getAllowedLayouts(section) {
            var layouts = $scope.model.config.items.layouts;
            //This will occur if it is a new section which has been
            // created from a 'template'
            if (section.allowed && section.allowed.length > 0) {
                return _.filter(layouts, function (layout) {
                    return _.indexOf(section.allowed, layout.name) >= 0;
                });
            } else {
                return layouts;
            }
        }
        $scope.addRow = function (section, layout, isInit) {
            //copy the selected layout into the rows collection
            var row = angular.copy(layout);
            // Init row value
            row = $scope.initRow(row);
            // Push the new row
            if (row) {
                section.rows.push(row);
            }
            if (!isInit) {
                currentForm.$setDirty();
            }
            $scope.showRowConfigurations = false;
            eventsService.emit('grid.rowAdded', {
                scope: $scope,
                element: $element,
                row: row
            });
        };
        $scope.removeRow = function (section, $index) {
            if (section.rows.length > 0) {
                section.rows.splice($index, 1);
                $scope.currentRow = null;
                $scope.openRTEToolbarId = null;
                currentForm.$setDirty();
            }
            if (section.rows.length === 0) {
                $scope.showRowConfigurations = true;
            }
        };
        var shouldApply = function shouldApply(item, itemType, gridItem) {
            if (item.applyTo === undefined || item.applyTo === null || item.applyTo === '') {
                return true;
            }
            if (typeof item.applyTo === 'string') {
                return item.applyTo === itemType;
            }
            if (itemType === 'row') {
                if (item.applyTo.row === undefined) {
                    return false;
                }
                if (item.applyTo.row === null || item.applyTo.row === '') {
                    return true;
                }
                var rows = item.applyTo.row.split(',');
                return _.indexOf(rows, gridItem.name) !== -1;
            } else if (itemType === 'cell') {
                if (item.applyTo.cell === undefined) {
                    return false;
                }
                if (item.applyTo.cell === null || item.applyTo.cell === '') {
                    return true;
                }
                var cells = item.applyTo.cell.split(',');
                var cellSize = gridItem.grid.toString();
                return _.indexOf(cells, cellSize) !== -1;
            }
        };
        $scope.editGridItemSettings = function (gridItem, itemType) {
            placeHolder = '{0}';
            var styles, config;
            if (itemType === 'control') {
                styles = null;
                config = angular.copy(gridItem.editor.config.settings);
            } else {
                styles = _.filter(angular.copy($scope.model.config.items.styles), function (item) {
                    return shouldApply(item, itemType, gridItem);
                });
                config = _.filter(angular.copy($scope.model.config.items.config), function (item) {
                    return shouldApply(item, itemType, gridItem);
                });
            }
            if (angular.isObject(gridItem.config)) {
                _.each(config, function (cfg) {
                    var val = gridItem.config[cfg.key];
                    if (val) {
                        cfg.value = stripModifier(val, cfg.modifier);
                    }
                });
            }
            if (angular.isObject(gridItem.styles)) {
                _.each(styles, function (style) {
                    var val = gridItem.styles[style.key];
                    if (val) {
                        style.value = stripModifier(val, style.modifier);
                    }
                });
            }
            $scope.gridItemSettingsDialog = {};
            $scope.gridItemSettingsDialog.view = 'views/propertyeditors/grid/dialogs/config.html';
            $scope.gridItemSettingsDialog.title = 'Settings';
            $scope.gridItemSettingsDialog.styles = styles;
            $scope.gridItemSettingsDialog.config = config;
            $scope.gridItemSettingsDialog.show = true;
            $scope.gridItemSettingsDialog.submit = function (model) {
                var styleObject = {};
                var configObject = {};
                _.each(model.styles, function (style) {
                    if (style.value) {
                        styleObject[style.key] = addModifier(style.value, style.modifier);
                    }
                });
                _.each(model.config, function (cfg) {
                    if (cfg.value) {
                        configObject[cfg.key] = addModifier(cfg.value, cfg.modifier);
                    }
                });
                gridItem.styles = styleObject;
                gridItem.config = configObject;
                gridItem.hasConfig = gridItemHasConfig(styleObject, configObject);
                currentForm.$setDirty();
                $scope.gridItemSettingsDialog.show = false;
                $scope.gridItemSettingsDialog = null;
            };
            $scope.gridItemSettingsDialog.close = function (oldModel) {
                $scope.gridItemSettingsDialog.show = false;
                $scope.gridItemSettingsDialog = null;
            };
        };
        function stripModifier(val, modifier) {
            if (!val || !modifier || modifier.indexOf(placeHolder) < 0) {
                return val;
            } else {
                var paddArray = modifier.split(placeHolder);
                if (paddArray.length == 1) {
                    if (modifier.indexOf(placeHolder) === 0) {
                        return val.slice(0, -paddArray[0].length);
                    } else {
                        return val.slice(paddArray[0].length, 0);
                    }
                } else {
                    if (paddArray[1].length === 0) {
                        return val.slice(paddArray[0].length);
                    }
                    return val.slice(paddArray[0].length, -paddArray[1].length);
                }
            }
        }
        var addModifier = function addModifier(val, modifier) {
            if (!modifier || modifier.indexOf(placeHolder) < 0) {
                return val;
            } else {
                return modifier.replace(placeHolder, val);
            }
        };
        function gridItemHasConfig(styles, config) {
            if (_.isEmpty(styles) && _.isEmpty(config)) {
                return false;
            } else {
                return true;
            }
        }
        // *********************************************
        // Area management functions
        // *********************************************
        $scope.clickCell = function (index, cells, row) {
            cells[index].active = true;
            row.hasActiveChild = true;
        };
        $scope.clickOutsideCell = function (index, cells, row) {
            cells[index].active = false;
            row.hasActiveChild = hasActiveChild(row, cells);
        };
        $scope.cellPreview = function (cell) {
            if (cell && cell.$allowedEditors) {
                var editor = cell.$allowedEditors[0];
                return editor.icon;
            } else {
                return 'icon-layout';
            }
        };
        // *********************************************
        // Control management functions
        // *********************************************
        $scope.clickControl = function (index, controls, cell) {
            controls[index].active = true;
            cell.hasActiveChild = true;
        };
        $scope.clickOutsideControl = function (index, controls, cell) {
            controls[index].active = false;
            cell.hasActiveChild = hasActiveChild(cell, controls);
        };
        function hasActiveChild(item, children) {
            var activeChild = false;
            for (var i = 0; children.length > i; i++) {
                var child = children[i];
                if (child.active) {
                    activeChild = true;
                }
            }
            if (activeChild) {
                return true;
            }
        }
        var guid = function () {
            function s4() {
                return Math.floor((1 + Math.random()) * 65536).toString(16).substring(1);
            }
            return function () {
                return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
            };
        }();
        $scope.setUniqueId = function (cell, index) {
            return guid();
        };
        $scope.addControl = function (editor, cell, index, initialize) {
            initialize = initialize !== false;
            var newControl = {
                value: null,
                editor: editor,
                $initializing: initialize
            };
            if (index === undefined) {
                index = cell.controls.length;
            }
            newControl.active = true;
            //populate control
            $scope.initControl(newControl, index + 1);
            cell.controls.push(newControl);
            eventsService.emit('grid.itemAdded', {
                scope: $scope,
                element: $element,
                cell: cell,
                item: newControl
            });
        };
        $scope.addTinyMce = function (cell) {
            var rte = $scope.getEditor('rte');
            $scope.addControl(rte, cell);
        };
        $scope.getEditor = function (alias) {
            return _.find($scope.availableEditors, function (editor) {
                return editor.alias === alias;
            });
        };
        $scope.removeControl = function (cell, $index) {
            $scope.currentControl = null;
            cell.controls.splice($index, 1);
        };
        $scope.percentage = function (spans) {
            return (spans / $scope.model.config.items.columns * 100).toFixed(8);
        };
        $scope.clearPrompt = function (scopedObject, e) {
            scopedObject.deletePrompt = false;
            e.preventDefault();
            e.stopPropagation();
        };
        $scope.togglePrompt = function (scopedObject) {
            scopedObject.deletePrompt = !scopedObject.deletePrompt;
        };
        $scope.hidePrompt = function (scopedObject) {
            scopedObject.deletePrompt = false;
        };
        $scope.toggleAddRow = function () {
            $scope.showRowConfigurations = !$scope.showRowConfigurations;
        };
        // *********************************************
        // Initialization
        // these methods are called from ng-init on the template
        // so we can controll their first load data
        //
        // intialization sets non-saved data like percentage sizing, allowed editors and
        // other data that should all be pre-fixed with $ to strip it out on save
        // *********************************************
        // *********************************************
        // Init template + sections
        // *********************************************
        $scope.initContent = function () {
            var clear = true;
            //settings indicator shortcut
            if ($scope.model.config.items.config && $scope.model.config.items.config.length > 0 || $scope.model.config.items.styles && $scope.model.config.items.styles.length > 0) {
                $scope.hasSettings = true;
            }
            //ensure the grid has a column value set,
            //if nothing is found, set it to 12
            if (!$scope.model.config.items.columns) {
                $scope.model.config.items.columns = 12;
            } else if (angular.isString($scope.model.config.items.columns)) {
                $scope.model.config.items.columns = parseInt($scope.model.config.items.columns);
            }
            if ($scope.model.value && $scope.model.value.sections && $scope.model.value.sections.length > 0 && $scope.model.value.sections[0].rows && $scope.model.value.sections[0].rows.length > 0) {
                if ($scope.model.value.name && angular.isArray($scope.model.config.items.templates)) {
                    //This will occur if it is an existing value, in which case
                    // we need to determine which layout was applied by looking up
                    // the name
                    // TODO: We need to change this to an immutable ID!!
                    var found = _.find($scope.model.config.items.templates, function (t) {
                        return t.name === $scope.model.value.name;
                    });
                    if (found && angular.isArray(found.sections) && found.sections.length === $scope.model.value.sections.length) {
                        //Cool, we've found the template associated with our current value with matching sections counts, now we need to
                        // merge this template data on to our current value (as if it was new) so that we can preserve what is and isn't
                        // allowed for this template based on the current config.
                        _.each(found.sections, function (templateSection, index) {
                            angular.extend($scope.model.value.sections[index], angular.copy(templateSection));
                        });
                    }
                }
                _.forEach($scope.model.value.sections, function (section, index) {
                    if (section.grid > 0) {
                        $scope.initSection(section);
                        //we do this to ensure that the grid can be reset by deleting the last row
                        if (section.rows.length > 0) {
                            clear = false;
                        }
                    } else {
                        $scope.model.value.sections.splice(index, 1);
                    }
                });
            } else if ($scope.model.config.items.templates && $scope.model.config.items.templates.length === 1) {
                $scope.addTemplate($scope.model.config.items.templates[0]);
                clear = false;
            }
            if (clear) {
                $scope.model.value = undefined;
            }
        };
        $scope.initSection = function (section) {
            section.$percentage = $scope.percentage(section.grid);
            section.$allowedLayouts = getAllowedLayouts(section);
            if (!section.rows || section.rows.length === 0) {
                section.rows = [];
                if (section.$allowedLayouts.length === 1) {
                    $scope.addRow(section, section.$allowedLayouts[0], true);
                }
            } else {
                _.forEach(section.rows, function (row, index) {
                    if (!row.$initialized) {
                        var initd = $scope.initRow(row);
                        //if init fails, remove
                        if (!initd) {
                            section.rows.splice(index, 1);
                        } else {
                            section.rows[index] = initd;
                        }
                    }
                });
                // if there is more than one row added - hide row add tools
                $scope.showRowConfigurations = false;
            }
        };
        // *********************************************
        // Init layout / row
        // *********************************************
        $scope.initRow = function (row) {
            //merge the layout data with the original config data
            //if there are no config info on this, splice it out
            var original = _.find($scope.model.config.items.layouts, function (o) {
                return o.name === row.name;
            });
            if (!original) {
                return null;
            } else {
                //make a copy to not touch the original config
                original = angular.copy(original);
                original.styles = row.styles;
                original.config = row.config;
                original.hasConfig = gridItemHasConfig(row.styles, row.config);
                //sync area configuration
                _.each(original.areas, function (area, areaIndex) {
                    if (area.grid > 0) {
                        var currentArea = row.areas[areaIndex];
                        if (currentArea) {
                            area.config = currentArea.config;
                            area.styles = currentArea.styles;
                            area.hasConfig = gridItemHasConfig(currentArea.styles, currentArea.config);
                        }
                        //set editor permissions
                        if (!area.allowed || area.allowAll === true) {
                            area.$allowedEditors = $scope.availableEditors;
                            area.$allowsRTE = true;
                        } else {
                            area.$allowedEditors = _.filter($scope.availableEditors, function (editor) {
                                return _.indexOf(area.allowed, editor.alias) >= 0;
                            });
                            if (_.indexOf(area.allowed, 'rte') >= 0) {
                                area.$allowsRTE = true;
                            }
                        }
                        //copy over existing controls into the new areas
                        if (row.areas.length > areaIndex && row.areas[areaIndex].controls) {
                            area.controls = currentArea.controls;
                            _.forEach(area.controls, function (control, controlIndex) {
                                $scope.initControl(control, controlIndex);
                            });
                        } else {
                            //if empty
                            area.controls = [];
                            //if only one allowed editor
                            if (area.$allowedEditors.length === 1) {
                                $scope.addControl(area.$allowedEditors[0], area, 0, false);
                            }
                        }
                        //set width
                        area.$percentage = $scope.percentage(area.grid);
                        area.$uniqueId = $scope.setUniqueId();
                    } else {
                        original.areas.splice(areaIndex, 1);
                    }
                });
                //replace the old row
                original.$initialized = true;
                //set a disposable unique ID
                original.$uniqueId = $scope.setUniqueId();
                //set a no disposable unique ID (util for row styling)
                original.id = !row.id ? $scope.setUniqueId() : row.id;
                return original;
            }
        };
        // *********************************************
        // Init control
        // *********************************************
        $scope.initControl = function (control, index) {
            control.$index = index;
            control.$uniqueId = $scope.setUniqueId();
            //error handling in case of missing editor..
            //should only happen if stripped earlier
            if (!control.editor) {
                control.$editorPath = 'views/propertyeditors/grid/editors/error.html';
            }
            if (!control.$editorPath) {
                var editorConfig = $scope.getEditor(control.editor.alias);
                if (editorConfig) {
                    control.editor = editorConfig;
                    //if its an absolute path
                    if (control.editor.view.startsWith('/') || control.editor.view.startsWith('~/')) {
                        control.$editorPath = umbRequestHelper.convertVirtualToAbsolutePath(control.editor.view);
                    } else {
                        //use convention
                        control.$editorPath = 'views/propertyeditors/grid/editors/' + control.editor.view + '.html';
                    }
                } else {
                    control.$editorPath = 'views/propertyeditors/grid/editors/error.html';
                }
            }
        };
        gridService.getGridEditors().then(function (response) {
            $scope.availableEditors = response.data;
            //Localize the grid editor names
            angular.forEach($scope.availableEditors, function (value, key) {
                //If no translation is provided, keep using the editor name from the manifest
                if (localizationService.dictionary.hasOwnProperty('grid_' + value.alias)) {
                    localizationService.localize('grid_' + value.alias).then(function (v) {
                        value.name = v;
                    });
                }
            });
            $scope.contentReady = true;
            // *********************************************
            // Init grid
            // *********************************************
            eventsService.emit('grid.initializing', {
                scope: $scope,
                element: $element
            });
            $scope.initContent();
            eventsService.emit('grid.initialized', {
                scope: $scope,
                element: $element
            });
        });
        //Clean the grid value before submitting to the server, we don't need
        // all of that grid configuration in the value to be stored!! All of that
        // needs to be merged in at runtime to ensure that the real config values are used
        // if they are ever updated.
        var unsubscribe = $scope.$on('formSubmitting', function () {
            if ($scope.model.value && $scope.model.value.sections) {
                _.each($scope.model.value.sections, function (section) {
                    if (section.rows) {
                        _.each(section.rows, function (row) {
                            if (row.areas) {
                                _.each(row.areas, function (area) {
                                    //Remove the 'editors' - these are the allowed editors, these will
                                    // be injected at runtime to this editor, it should not be persisted
                                    if (area.editors) {
                                        delete area.editors;
                                    }
                                    if (area.controls) {
                                        _.each(area.controls, function (control) {
                                            if (control.editor) {
                                                //replace
                                                var alias = control.editor.alias;
                                                control.editor = { alias: alias };
                                            }
                                        });
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });
        //when the scope is destroyed we need to unsubscribe
        $scope.$on('$destroy', function () {
            unsubscribe();
        });
    });
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.GridPrevalueEditorController', function ($scope, gridService) {
        var emptyModel = {
            styles: [{
                    label: 'Set a background image',
                    description: 'Set a row background',
                    key: 'background-image',
                    view: 'imagepicker',
                    modifier: 'url({0})'
                }],
            config: [{
                    label: 'Class',
                    description: 'Set a css class',
                    key: 'class',
                    view: 'textstring'
                }],
            columns: 12,
            templates: [
                {
                    name: '1 column layout',
                    sections: [{ grid: 12 }]
                },
                {
                    name: '2 column layout',
                    sections: [
                        { grid: 4 },
                        { grid: 8 }
                    ]
                }
            ],
            layouts: [
                {
                    label: 'Headline',
                    name: 'Headline',
                    areas: [{
                            grid: 12,
                            editors: ['headline']
                        }]
                },
                {
                    label: 'Article',
                    name: 'Article',
                    areas: [
                        { grid: 4 },
                        { grid: 8 }
                    ]
                }
            ]
        };
        /****************
      template
  *****************/
        $scope.configureTemplate = function (template) {
            var templatesCopy = angular.copy($scope.model.value.templates);
            if (template === undefined) {
                template = {
                    name: '',
                    sections: []
                };
                $scope.model.value.templates.push(template);
            }
            $scope.layoutConfigOverlay = {};
            $scope.layoutConfigOverlay.view = 'views/propertyEditors/grid/dialogs/layoutconfig.html';
            $scope.layoutConfigOverlay.currentLayout = template;
            $scope.layoutConfigOverlay.rows = $scope.model.value.layouts;
            $scope.layoutConfigOverlay.columns = $scope.model.value.columns;
            $scope.layoutConfigOverlay.show = true;
            $scope.layoutConfigOverlay.submit = function (model) {
                $scope.layoutConfigOverlay.show = false;
                $scope.layoutConfigOverlay = null;
            };
            $scope.layoutConfigOverlay.close = function (oldModel) {
                //reset templates
                $scope.model.value.templates = templatesCopy;
                $scope.layoutConfigOverlay.show = false;
                $scope.layoutConfigOverlay = null;
            };
        };
        $scope.deleteTemplate = function (index) {
            $scope.model.value.templates.splice(index, 1);
        };
        /****************
      Row
  *****************/
        $scope.configureLayout = function (layout) {
            var layoutsCopy = angular.copy($scope.model.value.layouts);
            if (layout === undefined) {
                layout = {
                    name: '',
                    areas: []
                };
                $scope.model.value.layouts.push(layout);
            }
            $scope.rowConfigOverlay = {};
            $scope.rowConfigOverlay.view = 'views/propertyEditors/grid/dialogs/rowconfig.html';
            $scope.rowConfigOverlay.currentRow = layout;
            $scope.rowConfigOverlay.editors = $scope.editors;
            $scope.rowConfigOverlay.columns = $scope.model.value.columns;
            $scope.rowConfigOverlay.show = true;
            $scope.rowConfigOverlay.submit = function (model) {
                $scope.rowConfigOverlay.show = false;
                $scope.rowConfigOverlay = null;
            };
            $scope.rowConfigOverlay.close = function (oldModel) {
                $scope.model.value.layouts = layoutsCopy;
                $scope.rowConfigOverlay.show = false;
                $scope.rowConfigOverlay = null;
            };
        };
        //var rowDeletesPending = false;
        $scope.deleteLayout = function (index) {
            $scope.rowDeleteOverlay = {};
            $scope.rowDeleteOverlay.view = 'views/propertyEditors/grid/dialogs/rowdeleteconfirm.html';
            $scope.rowDeleteOverlay.dialogData = { rowName: $scope.model.value.layouts[index].name };
            $scope.rowDeleteOverlay.show = true;
            $scope.rowDeleteOverlay.submit = function (model) {
                $scope.model.value.layouts.splice(index, 1);
                $scope.rowDeleteOverlay.show = false;
                $scope.rowDeleteOverlay = null;
            };
            $scope.rowDeleteOverlay.close = function (oldModel) {
                $scope.rowDeleteOverlay.show = false;
                $scope.rowDeleteOverlay = null;
            };
        };
        /****************
      utillities
  *****************/
        $scope.toggleCollection = function (collection, toggle) {
            if (toggle) {
                collection = [];
            } else {
                collection = null;
            }
        };
        $scope.percentage = function (spans) {
            return (spans / $scope.model.value.columns * 100).toFixed(8);
        };
        $scope.zeroWidthFilter = function (cell) {
            return cell.grid > 0;
        };
        /****************
      Config
  *****************/
        $scope.removeConfigValue = function (collection, index) {
            collection.splice(index, 1);
        };
        var editConfigCollection = function editConfigCollection(configValues, title, callback) {
            $scope.editConfigCollectionOverlay = {};
            $scope.editConfigCollectionOverlay.view = 'views/propertyeditors/grid/dialogs/editconfig.html';
            $scope.editConfigCollectionOverlay.config = configValues;
            $scope.editConfigCollectionOverlay.title = title;
            $scope.editConfigCollectionOverlay.show = true;
            $scope.editConfigCollectionOverlay.submit = function (model) {
                callback(model.config);
                $scope.editConfigCollectionOverlay.show = false;
                $scope.editConfigCollectionOverlay = null;
            };
            $scope.editConfigCollectionOverlay.close = function (oldModel) {
                $scope.editConfigCollectionOverlay.show = false;
                $scope.editConfigCollectionOverlay = null;
            };
        };
        $scope.editConfig = function () {
            editConfigCollection($scope.model.value.config, 'Settings', function (data) {
                $scope.model.value.config = data;
            });
        };
        $scope.editStyles = function () {
            editConfigCollection($scope.model.value.styles, 'Styling', function (data) {
                $scope.model.value.styles = data;
            });
        };
        /****************
      editors
  *****************/
        gridService.getGridEditors().then(function (response) {
            $scope.editors = response.data;
        });
        /* init grid data */
        if (!$scope.model.value || $scope.model.value === '' || !$scope.model.value.templates) {
            $scope.model.value = emptyModel;
        } else {
            if (!$scope.model.value.columns) {
                $scope.model.value.columns = emptyModel.columns;
            }
            if (!$scope.model.value.config) {
                $scope.model.value.config = [];
            }
            if (!$scope.model.value.styles) {
                $scope.model.value.styles = [];
            }
        }
        /****************
      Clean up
  *****************/
        var unsubscribe = $scope.$on('formSubmitting', function (ev, args) {
            var ts = $scope.model.value.templates;
            var ls = $scope.model.value.layouts;
            _.each(ts, function (t) {
                _.each(t.sections, function (section, index) {
                    if (section.grid === 0) {
                        t.sections.splice(index, 1);
                    }
                });
            });
            _.each(ls, function (l) {
                _.each(l.areas, function (area, index) {
                    if (area.grid === 0) {
                        l.areas.splice(index, 1);
                    }
                });
            });
        });
        //when the scope is destroyed we need to unsubscribe
        $scope.$on('$destroy', function () {
            unsubscribe();
        });
    });
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.IdWithGuidValueController
 * @function
 * 
 * @description
 * The controller for the idwithguid property editor, which formats the ID as normal
 * with the GUID in smaller text below, as used across the backoffice.
*/
    function IdWithGuidValueController($rootScope, $scope, $filter) {
        function formatDisplayValue() {
            if ($scope.model.value.length > 1) {
                $scope.displayid = $scope.model.value[0];
                $scope.displayguid = $scope.model.value[1];
            } else {
                $scope.displayid = $scope.model.value;
            }
        }
        //format the display value on init:
        formatDisplayValue();
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.IdWithGuidValueController', IdWithGuidValueController);
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.ImageCropperController', function ($scope, fileManager) {
        var config = angular.copy($scope.model.config);
        $scope.filesSelected = onFileSelected;
        $scope.filesChanged = onFilesChanged;
        $scope.fileUploaderInit = onFileUploaderInit;
        $scope.imageLoaded = imageLoaded;
        $scope.crop = crop;
        $scope.done = done;
        $scope.clear = clear;
        $scope.reset = reset;
        $scope.close = close;
        $scope.focalPointChanged = focalPointChanged;
        //declare a special method which will be called whenever the value has changed from the server
        $scope.model.onValueChanged = onValueChanged;
        /**
   * Called when the umgImageGravity component updates the focal point value
   * @param {any} left
   * @param {any} top
   */
        function focalPointChanged(left, top) {
            //update the model focalpoint value
            $scope.model.value.focalPoint = {
                left: left,
                top: top
            };
            //set form to dirty to track changes
            $scope.imageCropperForm.$setDirty();
        }
        /**
   * Used to assign a new model value
   * @param {any} src
   */
        function setModelValueWithSrc(src) {
            if (!$scope.model.value || !$scope.model.value.src) {
                //we are copying to not overwrite the original config
                $scope.model.value = angular.extend(angular.copy($scope.model.config), { src: src });
            }
        }
        /**
   * called whenever the value has changed from the server
   * @param {any} newVal
   * @param {any} oldVal
   */
        function onValueChanged(newVal, oldVal) {
            //clear current uploaded files
            fileManager.setFiles({
                propertyAlias: $scope.model.alias,
                culture: $scope.model.culture,
                files: []
            });
        }
        /**
   * Called when the a new file is selected
   * @param {any} value
   */
        function onFileSelected(value, files) {
            setModelValueWithSrc(value);
            //set form to dirty to track changes
            $scope.imageCropperForm.$setDirty();
        }
        function imageLoaded(isCroppable, hasDimensions) {
            $scope.isCroppable = isCroppable;
            $scope.hasDimensions = hasDimensions;
        }
        ;
        /**
   * Called when the file collection changes
   * @param {any} value
   * @param {any} files
   */
        function onFilesChanged(files) {
            if (files && files[0]) {
                $scope.imageSrc = files[0].fileSrc;
                //set form to dirty to track changes
                $scope.imageCropperForm.$setDirty();
            }
        }
        /**
   * Called when the file uploader initializes
   * @param {any} value
   */
        function onFileUploaderInit(value, files) {
            //move previously saved value to the editor
            if ($scope.model.value) {
                //backwards compat with the old file upload (incase some-one swaps them..)
                if (angular.isString($scope.model.value)) {
                    setModelValueWithSrc($scope.model.value);
                } else if ($scope.model.value.crops) {
                    //sync any config changes with the editor and drop outdated crops
                    _.each($scope.model.value.crops, function (saved) {
                        var configured = _.find(config.crops, function (item) {
                            return item.alias === saved.alias;
                        });
                        if (configured && configured.height === saved.height && configured.width === saved.width) {
                            configured.coordinates = saved.coordinates;
                        }
                    });
                    $scope.model.value.crops = config.crops;
                    //restore focalpoint if missing
                    if (!$scope.model.value.focalPoint) {
                        $scope.model.value.focalPoint = {
                            left: 0.5,
                            top: 0.5
                        };
                    }
                }
                //if there are already files in the client assigned then set the src
                if (files && files[0]) {
                    $scope.imageSrc = files[0].fileSrc;
                } else {
                    $scope.imageSrc = $scope.model.value.src;
                }
            }
        }
        /**
   * crop a specific crop
   * @param {any} crop
   */
        function crop(crop) {
            // clone the crop so we can discard the changes
            $scope.currentCrop = angular.copy(crop);
            $scope.currentPoint = null;
            //set form to dirty to track changes
            $scope.imageCropperForm.$setDirty();
        }
        ;
        /** done cropping */
        function done() {
            if (!$scope.currentCrop) {
                return;
            }
            // find the original crop by crop alias and update its coordinates
            var editedCrop = _.find($scope.model.value.crops, function (crop) {
                return crop.alias === $scope.currentCrop.alias;
            });
            editedCrop.coordinates = $scope.currentCrop.coordinates;
            $scope.close();
            //set form to dirty to track changes
            $scope.imageCropperForm.$setDirty();
        }
        ;
        function reset() {
            $scope.currentCrop.coordinates = undefined;
            $scope.done();
        }
        function close() {
            $scope.currentCrop = undefined;
            $scope.currentPoint = undefined;
        }
        /**
   * crop a specific crop
   * @param {any} crop
   */
        function clear(crop) {
            //clear current uploaded files
            fileManager.setFiles({
                propertyAlias: $scope.model.alias,
                culture: $scope.model.culture,
                files: []
            });
            //clear the ui
            $scope.imageSrc = null;
            if ($scope.model.value) {
                $scope.model.value = null;
            }
            //set form to dirty to track changes
            $scope.imageCropperForm.$setDirty();
        }
        ;
        var unsubscribe = $scope.$on('formSubmitting', function () {
            $scope.currentCrop = null;
            $scope.currentPoint = null;
        });
        $scope.$on('$destroy', function () {
            unsubscribe();
        });
    }).run(function (mediaHelper, umbRequestHelper) {
        if (mediaHelper && mediaHelper.registerFileResolver) {
            //NOTE: The 'entity' can be either a normal media entity or an "entity" returned from the entityResource
            // they contain different data structures so if we need to query against it we need to be aware of this.
            mediaHelper.registerFileResolver('Umbraco.ImageCropper', function (property, entity, thumbnail) {
                if (property.value && property.value.src) {
                    if (thumbnail === true) {
                        return property.value.src + '?width=500&mode=max&animationprocessmode=first';
                    } else {
                        return property.value.src;
                    }    //this is a fallback in case the cropper has been asssigned a upload field
                } else if (angular.isString(property.value)) {
                    if (thumbnail) {
                        if (mediaHelper.detectIfImageByExtension(property.value)) {
                            var thumbnailUrl = umbRequestHelper.getApiUrl('imagesApiBaseUrl', 'GetBigThumbnail', [{ originalImagePath: property.value }]);
                            return thumbnailUrl;
                        } else {
                            return null;
                        }
                    } else {
                        return property.value;
                    }
                }
                return null;
            });
        }
    });
    'use strict';
    angular.module('umbraco').controller('Umbraco.PrevalueEditors.CropSizesController', function ($scope) {
        if (!$scope.model.value) {
            $scope.model.value = [];
        }
        $scope.editMode = false;
        $scope.setFocus = false;
        $scope.remove = function (item, evt) {
            evt.preventDefault();
            $scope.model.value = _.reject($scope.model.value, function (x) {
                return x.alias === item.alias;
            });
        };
        $scope.edit = function (item, evt) {
            evt.preventDefault();
            $scope.editMode = true;
            $scope.setFocus = false;
            $scope.newItem = item;
        };
        $scope.cancel = function (evt) {
            evt.preventDefault();
            $scope.editMode = false;
            $scope.setFocus = true;
            $scope.newItem = null;
        };
        $scope.change = function () {
            // Listen to the change event and set focus 2 false
            if ($scope.setFocus) {
                $scope.setFocus = false;
                return;
            }
        };
        $scope.add = function (evt) {
            evt.preventDefault();
            $scope.editMode = false;
            $scope.setFocus = true;
            if ($scope.newItem && $scope.newItem.alias && angular.isNumber($scope.newItem.width) && angular.isNumber($scope.newItem.height) && $scope.newItem.width > 0 && $scope.newItem.height > 0) {
                var exists = _.find($scope.model.value, function (item) {
                    return $scope.newItem.alias === item.alias;
                });
                if (!exists) {
                    $scope.model.value.push($scope.newItem);
                    $scope.newItem = {};
                    $scope.hasError = false;
                    $scope.cropAdded = false;
                    return;
                } else {
                    $scope.newItem = null;
                    $scope.hasError = false;
                    return;
                }
            }
            //there was an error, do the highlight (will be set back by the directive)
            $scope.hasError = true;
        };
        $scope.sortableOptions = { axis: 'y' };
    });
    'use strict';
    function includePropsPreValsController($rootScope, $scope, localizationService, contentTypeResource) {
        if (!$scope.model.value) {
            $scope.model.value = [];
        }
        $scope.hasError = false;
        $scope.errorMsg = '';
        $scope.propertyAliases = [];
        $scope.selectedField = null;
        $scope.systemFields = [
            { value: 'sortOrder' },
            { value: 'updateDate' },
            { value: 'updater' },
            { value: 'createDate' },
            { value: 'owner' },
            { value: 'published' },
            { value: 'contentTypeAlias' },
            { value: 'email' },
            { value: 'username' }
        ];
        $scope.getLocalizedKey = function (alias) {
            switch (alias) {
            case 'name':
                return 'general_name';
            case 'sortOrder':
                return 'general_sort';
            case 'updateDate':
                return 'content_updateDate';
            case 'updater':
                return 'content_updatedBy';
            case 'createDate':
                return 'content_createDate';
            case 'owner':
                return 'content_createBy';
            case 'published':
                return 'content_isPublished';
            case 'contentTypeAlias':
                //NOTE: This will just be 'Document' type even if it's for media/members since this is just a pre-val editor and we don't have a key for 'Content Type Alias'
                return 'content_documentType';
            case 'email':
                return 'general_email';
            case 'username':
                return 'general_username';
            }
            return alias;
        };
        $scope.changeField = function () {
            $scope.hasError = false;
            $scope.errorMsg = '';
        };
        $scope.removeField = function (e) {
            $scope.model.value = _.reject($scope.model.value, function (x) {
                return x.alias === e.alias;
            });
        };
        //now we'll localize these strings, for some reason the directive doesn't work inside of the select group with an ng-model declared
        _.each($scope.systemFields, function (e, i) {
            var key = $scope.getLocalizedKey(e.value);
            localizationService.localize(key).then(function (v) {
                e.name = v;
                switch (e.value) {
                case 'updater':
                    e.name += ' (Content only)';
                    break;
                case 'published':
                    e.name += ' (Content only)';
                    break;
                case 'email':
                    e.name += ' (Members only)';
                    break;
                case 'username':
                    e.name += ' (Members only)';
                    break;
                }
            });
        });
        // Return a helper with preserved width of cells
        var fixHelper = function fixHelper(e, ui) {
            ui.children().each(function () {
                $(this).width($(this).width());
            });
            var row = ui.clone();
            row.css('background-color', 'lightgray');
            return row;
        };
        $scope.sortableOptions = {
            helper: fixHelper,
            handle: '.handle',
            opacity: 0.5,
            axis: 'y',
            containment: 'parent',
            cursor: 'move',
            items: '> tr',
            tolerance: 'pointer',
            forcePlaceholderSize: true,
            start: function start(e, ui) {
                ui.placeholder.height(ui.item.height());
            },
            update: function update(e, ui) {
                // Get the new and old index for the moved element (using the text as the identifier)
                var newIndex = ui.item.index();
                var movedAlias = $('.alias-value', ui.item).text().trim();
                var originalIndex = getAliasIndexByText(movedAlias);
                // Move the element in the model
                if (originalIndex > -1) {
                    var movedElement = $scope.model.value[originalIndex];
                    $scope.model.value.splice(originalIndex, 1);
                    $scope.model.value.splice(newIndex, 0, movedElement);
                }
            }
        };
        contentTypeResource.getAllPropertyTypeAliases().then(function (data) {
            $scope.propertyAliases = data;
        });
        $scope.addField = function () {
            var val = $scope.selectedField;
            if (val) {
                var isSystem = val.startsWith('_system_');
                if (isSystem) {
                    val = val.trimStart('_system_');
                }
                var exists = _.find($scope.model.value, function (i) {
                    return i.alias === val;
                });
                if (!exists) {
                    $scope.hasError = false;
                    $scope.errorMsg = '';
                    $scope.model.value.push({
                        alias: val,
                        isSystem: isSystem ? 1 : 0
                    });
                } else {
                    //there was an error, do the highlight (will be set back by the directive)
                    $scope.hasError = true;
                    $scope.errorMsg = 'Property is already added';
                }
            } else {
                $scope.hasError = true;
                $scope.errorMsg = 'No property selected';
            }
        };
        function getAliasIndexByText(value) {
            for (var i = 0; i < $scope.model.value.length; i++) {
                if ($scope.model.value[i].alias === value) {
                    return i;
                }
            }
            return -1;
        }
    }
    angular.module('umbraco').controller('Umbraco.PrevalueEditors.IncludePropertiesListViewController', includePropsPreValsController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.PrevalueEditors.ListViewLayoutsPreValsController
 * @function
 *
 * @description
 * The controller for configuring layouts for list views
 */
    (function () {
        'use strict';
        function ListViewLayoutsPreValsController($scope, editorService) {
            var vm = this;
            vm.focusLayoutName = false;
            vm.layoutsSortableOptions = {
                distance: 10,
                tolerance: 'pointer',
                opacity: 0.7,
                scroll: true,
                cursor: 'move',
                handle: '.list-view-layout__sort-handle'
            };
            vm.addLayout = addLayout;
            vm.showPrompt = showPrompt;
            vm.hidePrompt = hidePrompt;
            vm.removeLayout = removeLayout;
            vm.openIconPicker = openIconPicker;
            function activate() {
            }
            function addLayout() {
                vm.focusLayoutName = false;
                var layout = {
                    'name': '',
                    'path': '',
                    'icon': 'icon-stop',
                    'selected': true
                };
                $scope.model.value.push(layout);
            }
            function showPrompt(layout) {
                layout.deletePrompt = true;
            }
            function hidePrompt(layout) {
                layout.deletePrompt = false;
            }
            function removeLayout($index, layout) {
                $scope.model.value.splice($index, 1);
            }
            function openIconPicker(layout) {
                var iconPicker = {
                    submit: function submit(model) {
                        if (model.color) {
                            layout.icon = model.icon + ' ' + model.color;
                        } else {
                            layout.icon = model.icon;
                        }
                        vm.focusLayoutName = true;
                        editorService.close();
                    },
                    close: function close() {
                        editorService.close();
                    }
                };
                editorService.iconPicker(iconPicker);
            }
            activate();
        }
        angular.module('umbraco').controller('Umbraco.PrevalueEditors.ListViewLayoutsPreValsController', ListViewLayoutsPreValsController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.DocumentType.EditController
 * @function
 *
 * @description
 * The controller for the content type editor
 */
    (function () {
        'use strict';
        function ListViewGridLayoutController($scope, $routeParams, mediaHelper, mediaResource, $location, listViewHelper, mediaTypeHelper) {
            var vm = this;
            var umbracoSettings = Umbraco.Sys.ServerVariables.umbracoSettings;
            vm.nodeId = $scope.contentId;
            // Use whitelist of allowed file types if provided
            vm.acceptedFileTypes = mediaHelper.formatFileTypes(umbracoSettings.allowedUploadFiles);
            if (vm.acceptedFileTypes === '') {
                // If not provided, we pass in a blacklist by adding ! to the file extensions, allowing everything EXCEPT for disallowedUploadFiles
                vm.acceptedFileTypes = !mediaHelper.formatFileTypes(umbracoSettings.disallowedUploadFiles);
            }
            vm.maxFileSize = umbracoSettings.maxFileSize + 'KB';
            vm.activeDrag = false;
            vm.mediaDetailsTooltip = {};
            vm.itemsWithoutFolders = [];
            vm.isRecycleBin = $scope.contentId === '-21' || $scope.contentId === '-20';
            vm.acceptedMediatypes = [];
            vm.dragEnter = dragEnter;
            vm.dragLeave = dragLeave;
            vm.onFilesQueue = onFilesQueue;
            vm.onUploadComplete = onUploadComplete;
            vm.hoverMediaItemDetails = hoverMediaItemDetails;
            vm.selectContentItem = selectContentItem;
            vm.selectItem = selectItem;
            vm.selectFolder = selectFolder;
            vm.goToItem = goToItem;
            function activate() {
                vm.itemsWithoutFolders = filterOutFolders($scope.items);
                //no need to make another REST/DB call if this data is not used when we are browsing the bin
                if ($scope.entityType === 'media' && !vm.isRecycleBin) {
                    mediaTypeHelper.getAllowedImagetypes(vm.nodeId).then(function (types) {
                        vm.acceptedMediatypes = types;
                    });
                }
            }
            function filterOutFolders(items) {
                var newArray = [];
                if (items && items.length) {
                    for (var i = 0; items.length > i; i++) {
                        var item = items[i];
                        var isFolder = !mediaHelper.hasFilePropertyType(item);
                        if (!isFolder) {
                            newArray.push(item);
                        }
                    }
                }
                return newArray;
            }
            function dragEnter(el, event) {
                vm.activeDrag = true;
            }
            function dragLeave(el, event) {
                vm.activeDrag = false;
            }
            function onFilesQueue() {
                vm.activeDrag = false;
            }
            function onUploadComplete() {
                $scope.getContent($scope.contentId);
            }
            function hoverMediaItemDetails(item, event, hover) {
                if (hover && !vm.mediaDetailsTooltip.show) {
                    vm.mediaDetailsTooltip.event = event;
                    vm.mediaDetailsTooltip.item = item;
                    vm.mediaDetailsTooltip.show = true;
                } else if (!hover && vm.mediaDetailsTooltip.show) {
                    vm.mediaDetailsTooltip.show = false;
                }
            }
            function selectContentItem(item, $event, $index) {
                listViewHelper.selectHandler(item, $index, $scope.items, $scope.selection, $event);
            }
            function selectItem(item, $event, $index) {
                listViewHelper.selectHandler(item, $index, vm.itemsWithoutFolders, $scope.selection, $event);
            }
            function selectFolder(folder, $event, $index) {
                listViewHelper.selectHandler(folder, $index, $scope.folders, $scope.selection, $event);
            }
            function goToItem(item, $event, $index) {
                $location.path($scope.entityType + '/' + $scope.entityType + '/edit/' + item.id);
            }
            activate();
        }
        angular.module('umbraco').controller('Umbraco.PropertyEditors.ListView.GridLayoutController', ListViewGridLayoutController);
    }());
    'use strict';
    (function () {
        'use strict';
        function ListViewListLayoutController($scope, listViewHelper, $location, mediaHelper, mediaTypeHelper) {
            var vm = this;
            var umbracoSettings = Umbraco.Sys.ServerVariables.umbracoSettings;
            vm.nodeId = $scope.contentId;
            // Use whitelist of allowed file types if provided
            vm.acceptedFileTypes = mediaHelper.formatFileTypes(umbracoSettings.allowedUploadFiles);
            if (vm.acceptedFileTypes === '') {
                // If not provided, we pass in a blacklist by adding ! to the file extensions, allowing everything EXCEPT for disallowedUploadFiles
                vm.acceptedFileTypes = !mediaHelper.formatFileTypes(umbracoSettings.disallowedUploadFiles);
            }
            vm.maxFileSize = umbracoSettings.maxFileSize + 'KB';
            vm.activeDrag = false;
            vm.isRecycleBin = $scope.contentId === '-21' || $scope.contentId === '-20';
            vm.acceptedMediatypes = [];
            vm.selectItem = selectItem;
            vm.clickItem = clickItem;
            vm.selectAll = selectAll;
            vm.isSelectedAll = isSelectedAll;
            vm.isSortDirection = isSortDirection;
            vm.sort = sort;
            vm.dragEnter = dragEnter;
            vm.dragLeave = dragLeave;
            vm.onFilesQueue = onFilesQueue;
            vm.onUploadComplete = onUploadComplete;
            markAsSensitive();
            function activate() {
                if ($scope.entityType === 'media') {
                    mediaTypeHelper.getAllowedImagetypes(vm.nodeId).then(function (types) {
                        vm.acceptedMediatypes = types;
                    });
                }
            }
            function selectAll($event) {
                listViewHelper.selectAllItems($scope.items, $scope.selection, $event);
            }
            function isSelectedAll() {
                return listViewHelper.isSelectedAll($scope.items, $scope.selection);
            }
            function selectItem(selectedItem, $index, $event) {
                listViewHelper.selectHandler(selectedItem, $index, $scope.items, $scope.selection, $event);
            }
            function clickItem(item) {
                // if item.id is 2147483647 (int.MaxValue) use item.key
                $location.path($scope.entityType + '/' + $scope.entityType + '/edit/' + (item.id === 2147483647 ? item.key : item.id));
            }
            function isSortDirection(col, direction) {
                return listViewHelper.setSortingDirection(col, direction, $scope.options);
            }
            function sort(field, allow, isSystem) {
                if (allow) {
                    $scope.options.orderBySystemField = isSystem;
                    listViewHelper.setSorting(field, allow, $scope.options);
                    $scope.getContent($scope.contentId);
                }
            }
            // Dropzone upload functions
            function dragEnter(el, event) {
                vm.activeDrag = true;
            }
            function dragLeave(el, event) {
                vm.activeDrag = false;
            }
            function onFilesQueue() {
                vm.activeDrag = false;
            }
            function onUploadComplete() {
                $scope.getContent($scope.contentId);
            }
            function markAsSensitive() {
                angular.forEach($scope.options.includeProperties, function (option) {
                    option.isSensitive = false;
                    angular.forEach($scope.items, function (item) {
                        angular.forEach(item.properties, function (property) {
                            if (option.alias === property.alias) {
                                option.isSensitive = property.isSensitive;
                            }
                        });
                    });
                });
            }
            activate();
        }
        angular.module('umbraco').controller('Umbraco.PropertyEditors.ListView.ListLayoutController', ListViewListLayoutController);
    }());
    'use strict';
    function listViewController($scope, $routeParams, $injector, $timeout, currentUserResource, notificationsService, iconHelper, editorState, localizationService, appState, $location, listViewHelper, navigationService, editorService, overlayService, languageResource) {
        //this is a quick check to see if we're in create mode, if so just exit - we cannot show children for content
        // that isn't created yet, if we continue this will use the parent id in the route params which isn't what
        // we want. NOTE: This is just a safety check since when we scaffold an empty model on the server we remove
        // the list view tab entirely when it's new.
        if ($routeParams.create) {
            $scope.isNew = true;
            return;
        }
        //Now we need to check if this is for media, members or content because that will depend on the resources we use
        var contentResource, getContentTypesCallback, getListResultsCallback, deleteItemCallback, getIdCallback, createEditUrlCallback;
        //check the config for the entity type, or the current section name (since the config is only set in c#, not in pre-vals)
        if ($scope.model.config.entityType && $scope.model.config.entityType === 'member' || appState.getSectionState('currentSection') === 'member') {
            $scope.entityType = 'member';
            contentResource = $injector.get('memberResource');
            getContentTypesCallback = $injector.get('memberTypeResource').getTypes;
            getListResultsCallback = contentResource.getPagedResults;
            deleteItemCallback = contentResource.deleteByKey;
            getIdCallback = function getIdCallback(selected) {
                return selected.key;
            };
            createEditUrlCallback = function createEditUrlCallback(item) {
                return '/' + $scope.entityType + '/' + $scope.entityType + '/edit/' + item.key + '?page=' + $scope.options.pageNumber + '&listName=' + $scope.contentId;
            };
        } else {
            //check the config for the entity type, or the current section name (since the config is only set in c#, not in pre-vals)
            if ($scope.model.config.entityType && $scope.model.config.entityType === 'media' || appState.getSectionState('currentSection') === 'media') {
                $scope.entityType = 'media';
                contentResource = $injector.get('mediaResource');
                getContentTypesCallback = $injector.get('mediaTypeResource').getAllowedTypes;
            } else {
                $scope.entityType = 'content';
                contentResource = $injector.get('contentResource');
                getContentTypesCallback = $injector.get('contentTypeResource').getAllowedTypes;
            }
            getListResultsCallback = contentResource.getChildren;
            deleteItemCallback = contentResource.deleteById;
            getIdCallback = function getIdCallback(selected) {
                return selected.id;
            };
            createEditUrlCallback = function createEditUrlCallback(item) {
                return '/' + $scope.entityType + '/' + $scope.entityType + '/edit/' + item.id + '?page=' + $scope.options.pageNumber;
            };
        }
        $scope.pagination = [];
        $scope.isNew = false;
        $scope.actionInProgress = false;
        $scope.selection = [];
        $scope.folders = [];
        $scope.page = {};
        $scope.listViewResultSet = {
            totalPages: 0,
            items: []
        };
        $scope.createAllowedButtonSingle = false;
        $scope.createAllowedButtonSingleWithBlueprints = false;
        $scope.createAllowedButtonMultiWithBlueprints = false;
        //when this is null, we don't check permissions
        $scope.currentNodePermissions = null;
        if ($scope.entityType === 'content') {
            //Just ensure we do have an editorState
            if (editorState.current) {
                //Fetch current node allowed actions for the current user
                //This is the current node & not each individual child node in the list
                var currentUserPermissions = editorState.current.allowedActions;
                //Create a nicer model rather than the funky & hard to remember permissions strings
                $scope.currentNodePermissions = {
                    'canCopy': _.contains(currentUserPermissions, 'O'),
                    //Magic Char = O
                    'canCreate': _.contains(currentUserPermissions, 'C'),
                    //Magic Char = C
                    'canDelete': _.contains(currentUserPermissions, 'D'),
                    //Magic Char = D
                    'canMove': _.contains(currentUserPermissions, 'M'),
                    //Magic Char = M
                    'canPublish': _.contains(currentUserPermissions, 'U'),
                    //Magic Char = U
                    'canUnpublish': _.contains(currentUserPermissions, 'U')    //Magic Char = Z (however UI says it can't be set, so if we can publish 'U' we can unpublish)
                };
            }
        }
        //when this is null, we don't check permissions
        $scope.buttonPermissions = null;
        //When we are dealing with 'content', we need to deal with permissions on child nodes.
        // Currently there is no real good way to
        if ($scope.entityType === 'content') {
            var idsWithPermissions = null;
            $scope.buttonPermissions = {
                canCopy: true,
                canCreate: true,
                canDelete: true,
                canMove: true,
                canPublish: true,
                canUnpublish: true
            };
            $scope.$watch('selection.length', function (newVal, oldVal) {
                if (idsWithPermissions == null && newVal > 0 || idsWithPermissions != null) {
                    //get all of the selected ids
                    var ids = _.map($scope.selection, function (i) {
                        return i.id.toString();
                    });
                    //remove the dictionary items that don't have matching ids
                    var filtered = {};
                    _.each(idsWithPermissions, function (value, key, list) {
                        if (_.contains(ids, key)) {
                            filtered[key] = value;
                        }
                    });
                    idsWithPermissions = filtered;
                    //find all ids that we haven't looked up permissions for
                    var existingIds = _.keys(idsWithPermissions);
                    var missingLookup = _.map(_.difference(ids, existingIds), function (i) {
                        return Number(i);
                    });
                    if (missingLookup.length > 0) {
                        currentUserResource.getPermissions(missingLookup).then(function (p) {
                            $scope.buttonPermissions = listViewHelper.getButtonPermissions(p, idsWithPermissions);
                        });
                    } else {
                        $scope.buttonPermissions = listViewHelper.getButtonPermissions({}, idsWithPermissions);
                    }
                }
            });
        }
        $scope.options = {
            displayAtTabNumber: $scope.model.config.displayAtTabNumber ? $scope.model.config.displayAtTabNumber : 1,
            pageSize: $scope.model.config.pageSize ? $scope.model.config.pageSize : 10,
            pageNumber: $routeParams.page && Number($routeParams.page) != NaN && Number($routeParams.page) > 0 ? $routeParams.page : 1,
            filter: '',
            orderBy: ($scope.model.config.orderBy ? $scope.model.config.orderBy : 'VersionDate').trim(),
            orderDirection: $scope.model.config.orderDirection ? $scope.model.config.orderDirection.trim() : 'desc',
            orderBySystemField: true,
            includeProperties: $scope.model.config.includeProperties ? $scope.model.config.includeProperties : [
                {
                    alias: 'updateDate',
                    header: 'Last edited',
                    isSystem: 1
                },
                {
                    alias: 'updater',
                    header: 'Last edited by',
                    isSystem: 1
                }
            ],
            layout: {
                layouts: $scope.model.config.layouts,
                activeLayout: listViewHelper.getLayout($routeParams.id, $scope.model.config.layouts)
            },
            allowBulkPublish: $scope.entityType === 'content' && $scope.model.config.bulkActionPermissions.allowBulkPublish,
            allowBulkUnpublish: $scope.entityType === 'content' && $scope.model.config.bulkActionPermissions.allowBulkUnpublish,
            allowBulkCopy: $scope.entityType === 'content' && $scope.model.config.bulkActionPermissions.allowBulkCopy,
            allowBulkMove: $scope.model.config.bulkActionPermissions.allowBulkMove,
            allowBulkDelete: $scope.model.config.bulkActionPermissions.allowBulkDelete,
            cultureName: $routeParams.cculture ? $routeParams.cculture : $routeParams.mculture
        };
        //watch for culture changes in the query strings and update accordingly
        $scope.$watch(function () {
            return $routeParams.cculture ? $routeParams.cculture : $routeParams.mculture;
        }, function (newVal, oldVal) {
            if (newVal && newVal !== oldVal) {
                //update the options
                $scope.options.cultureName = newVal;
                $scope.reloadView($scope.contentId);
            }
        });
        // Check if selected order by field is actually custom field
        for (var j = 0; j < $scope.options.includeProperties.length; j++) {
            var includedProperty = $scope.options.includeProperties[j];
            if (includedProperty.alias.toLowerCase() === $scope.options.orderBy.toLowerCase()) {
                $scope.options.orderBySystemField = includedProperty.isSystem === 1;
                break;
            }
        }
        //update all of the system includeProperties to enable sorting
        _.each($scope.options.includeProperties, function (e, i) {
            //NOTE: special case for contentTypeAlias, it's a system property that cannot be sorted
            // to do that, we'd need to update the base query for content to include the content type alias column
            // which requires another join and would be slower. BUT We are doing this for members so not sure it makes a diff?
            if (e.alias != 'contentTypeAlias') {
                e.allowSorting = true;
            }
            // Another special case for members, only fields on the base table (cmsMember) can be used for sorting
            if (e.isSystem && $scope.entityType == 'member') {
                e.allowSorting = e.alias == 'username' || e.alias == 'email';
            }
            if (e.isSystem) {
                //localize the header
                var key = getLocalizedKey(e.alias);
                localizationService.localize(key).then(function (v) {
                    e.header = v;
                });
            }
        });
        $scope.selectLayout = function (layout) {
            $scope.options.layout.activeLayout = listViewHelper.setLayout($routeParams.id, layout, $scope.model.config.layouts);
        };
        function showNotificationsAndReset(err, reload, successMsgPromise) {
            //check if response is ysod
            if (err.status && err.status >= 500) {
                // Open ysod overlay
                $scope.ysodOverlay = {
                    view: 'ysod',
                    error: err,
                    show: true
                };
            }
            $timeout(function () {
                $scope.bulkStatus = '';
                $scope.actionInProgress = false;
            }, 500);
            if (successMsgPromise) {
                localizationService.localize('bulk_done').then(function (v) {
                    successMsgPromise.then(function (successMsg) {
                        notificationsService.success(v, successMsg);
                    });
                });
            }
        }
        $scope.next = function (pageNumber) {
            $scope.options.pageNumber = pageNumber;
            $scope.reloadView($scope.contentId);
        };
        $scope.goToPage = function (pageNumber) {
            $scope.options.pageNumber = pageNumber;
            $scope.reloadView($scope.contentId);
        };
        $scope.prev = function (pageNumber) {
            $scope.options.pageNumber = pageNumber;
            $scope.reloadView($scope.contentId);
        };
        /*Loads the search results, based on parameters set in prev,next,sort and so on*/
        /*Pagination is done by an array of objects, due angularJS's funky way of monitoring state
  with simple values */
        $scope.getContent = function (contentId) {
            $scope.reloadView($scope.contentId);
        };
        $scope.reloadView = function (id) {
            $scope.viewLoaded = false;
            $scope.folders = [];
            listViewHelper.clearSelection($scope.listViewResultSet.items, $scope.folders, $scope.selection);
            getListResultsCallback(id, $scope.options).then(function (data) {
                $scope.actionInProgress = false;
                $scope.listViewResultSet = data;
                //update all values for display
                if ($scope.listViewResultSet.items) {
                    _.each($scope.listViewResultSet.items, function (e, index) {
                        setPropertyValues(e);
                        if (e.contentTypeAlias === 'Folder') {
                            $scope.folders.push(e);
                        }
                    });
                }
                $scope.viewLoaded = true;
                //NOTE: This might occur if we are requesting a higher page number than what is actually available, for example
                // if you have more than one page and you delete all items on the last page. In this case, we need to reset to the last
                // available page and then re-load again
                if ($scope.options.pageNumber > $scope.listViewResultSet.totalPages) {
                    $scope.options.pageNumber = $scope.listViewResultSet.totalPages;
                    //reload!
                    $scope.reloadView(id);
                }
            });
        };
        var searchListView = _.debounce(function () {
            $scope.$apply(function () {
                makeSearch();
            });
        }, 500);
        $scope.forceSearch = function (ev) {
            //13: enter
            switch (ev.keyCode) {
            case 13:
                makeSearch();
                break;
            }
        };
        $scope.enterSearch = function () {
            $scope.viewLoaded = false;
            searchListView();
        };
        function makeSearch() {
            if ($scope.options.filter !== null && $scope.options.filter !== undefined) {
                $scope.options.pageNumber = 1;
                $scope.reloadView($scope.contentId);
            }
        }
        $scope.selectedItemsCount = function () {
            return $scope.selection.length;
        };
        $scope.clearSelection = function () {
            listViewHelper.clearSelection($scope.listViewResultSet.items, $scope.folders, $scope.selection);
        };
        $scope.getIcon = function (entry) {
            return iconHelper.convertFromLegacyIcon(entry.icon);
        };
        function serial(selected, fn, getStatusMsg, index) {
            return fn(selected, index).then(function (content) {
                index++;
                getStatusMsg(index, selected.length).then(function (value) {
                    $scope.bulkStatus = value;
                });
                return index < selected.length ? serial(selected, fn, getStatusMsg, index) : content;
            }, function (err) {
                var reload = index > 0;
                showNotificationsAndReset(err, reload);
                return err;
            });
        }
        function applySelected(fn, getStatusMsg, getSuccessMsg, confirmMsg) {
            var selected = $scope.selection;
            if (selected.length === 0)
                return;
            if (confirmMsg && !confirm(confirmMsg))
                return;
            $scope.actionInProgress = true;
            getStatusMsg(0, selected.length).then(function (value) {
                $scope.bulkStatus = value;
            });
            return serial(selected, fn, getStatusMsg, 0).then(function (result) {
                // executes once the whole selection has been processed
                // in case of an error (caught by serial), result will be the error
                if (!(result.data && angular.isArray(result.data.notifications)))
                    showNotificationsAndReset(result, true, getSuccessMsg(selected.length));
            });
        }
        $scope.delete = function () {
            var dialog = {
                view: 'views/propertyeditors/listview/overlays/delete.html',
                deletesVariants: selectionHasVariants(),
                submitButtonLabelKey: 'contentTypeEditor_yesDelete',
                submit: function submit(model) {
                    performDelete();
                    overlayService.close();
                },
                close: function close() {
                    overlayService.close();
                }
            };
            localizationService.localize('general_delete').then(function (value) {
                dialog.title = value;
                overlayService.open(dialog);
            });
        };
        function performDelete() {
            applySelected(function (selected, index) {
                return deleteItemCallback(getIdCallback(selected[index]));
            }, function (count, total) {
                var key = total === 1 ? 'bulk_deletedItemOfItem' : 'bulk_deletedItemOfItems';
                return localizationService.localize(key, [
                    count,
                    total
                ]);
            }, function (total) {
                var key = total === 1 ? 'bulk_deletedItem' : 'bulk_deletedItems';
                return localizationService.localize(key, [total]);
            }).then(function () {
                $scope.reloadView($scope.contentId);
            });
        }
        function selectionHasVariants() {
            var variesByCulture = false;
            // check if any of the selected nodes has variants
            $scope.selection.forEach(function (selectedItem) {
                $scope.listViewResultSet.items.forEach(function (resultItem) {
                    if ((selectedItem.id === resultItem.id || selectedItem.key === resultItem.key) && resultItem.variesByCulture) {
                        variesByCulture = true;
                    }
                });
            });
            return variesByCulture;
        }
        $scope.publish = function () {
            var dialog = {
                view: 'views/propertyeditors/listview/overlays/listviewpublish.html',
                submitButtonLabelKey: 'actions_publish',
                submit: function submit(model) {
                    // create a comma seperated array of selected cultures
                    var selectedCultures = [];
                    if (model.languages && model.languages.length > 0) {
                        model.languages.forEach(function (language) {
                            if (language.publish) {
                                selectedCultures.push(language.culture);
                            }
                        });
                    }
                    performPublish(selectedCultures);
                    overlayService.close();
                },
                close: function close() {
                    overlayService.close();
                }
            };
            // if any of the selected nodes has variants we want to 
            // show a dialog where the languages can be chosen
            if (selectionHasVariants()) {
                languageResource.getAll().then(function (languages) {
                    dialog.languages = languages;
                    overlayService.open(dialog);
                }, function (error) {
                    notificationsService.error(error);
                });
            } else {
                overlayService.open(dialog);
            }
        };
        function performPublish(cultures) {
            applySelected(function (selected, index) {
                return contentResource.publishById(getIdCallback(selected[index]), cultures);
            }, function (count, total) {
                var key = total === 1 ? 'bulk_publishedItemOfItem' : 'bulk_publishedItemOfItems';
                return localizationService.localize(key, [
                    count,
                    total
                ]);
            }, function (total) {
                var key = total === 1 ? 'bulk_publishedItem' : 'bulk_publishedItems';
                return localizationService.localize(key, [total]);
            }).then(function () {
                $scope.reloadView($scope.contentId);
            });
        }
        $scope.unpublish = function () {
            var dialog = {
                view: 'views/propertyeditors/listview/overlays/listviewunpublish.html',
                submitButtonLabelKey: 'actions_unpublish',
                submit: function submit(model) {
                    // create a comma seperated array of selected cultures
                    var selectedCultures = [];
                    if (model.languages && model.languages.length > 0) {
                        model.languages.forEach(function (language) {
                            if (language.unpublish) {
                                selectedCultures.push(language.culture);
                            }
                        });
                    }
                    performUnpublish(selectedCultures);
                    overlayService.close();
                },
                close: function close() {
                    overlayService.close();
                }
            };
            // if any of the selected nodes has variants we want to 
            // show a dialog where the languages can be chosen
            if (selectionHasVariants()) {
                languageResource.getAll().then(function (languages) {
                    dialog.languages = languages;
                    overlayService.open(dialog);
                }, function (error) {
                    notificationsService.error(error);
                });
            } else {
                overlayService.open(dialog);
            }
        };
        function performUnpublish(cultures) {
            applySelected(function (selected, index) {
                return contentResource.unpublish(getIdCallback(selected[index]), cultures);
            }, function (count, total) {
                var key = total === 1 ? 'bulk_unpublishedItemOfItem' : 'bulk_unpublishedItemOfItems';
                return localizationService.localize(key, [
                    count,
                    total
                ]);
            }, function (total) {
                var key = total === 1 ? 'bulk_unpublishedItem' : 'bulk_unpublishedItems';
                return localizationService.localize(key, [total]);
            }).then(function () {
                $scope.reloadView($scope.contentId);
            });
        }
        $scope.move = function () {
            var move = {
                section: $scope.entityType,
                currentNode: $scope.contentId,
                submit: function submit(model) {
                    if (model.target) {
                        performMove(model.target);
                    }
                    editorService.close();
                },
                close: function close() {
                    editorService.close();
                }
            };
            editorService.move(move);
        };
        function performMove(target) {
            //NOTE: With the way this applySelected/serial works, I'm not sure there's a better way currently to return
            // a specific value from one of the methods, so we'll have to try this way. Even though the first method
            // will fire once per every node moved, the destination path will be the same and we need to use that to sync.
            var newPath = null;
            applySelected(function (selected, index) {
                return contentResource.move({
                    parentId: target.id,
                    id: getIdCallback(selected[index])
                }).then(function (path) {
                    newPath = path;
                    return path;
                });
            }, function (count, total) {
                var key = total === 1 ? 'bulk_movedItemOfItem' : 'bulk_movedItemOfItems';
                return localizationService.localize(key, [
                    count,
                    total
                ]);
            }, function (total) {
                var key = total === 1 ? 'bulk_movedItem' : 'bulk_movedItems';
                return localizationService.localize(key, [total]);
            }).then(function () {
                //executes if all is successful, let's sync the tree
                if (newPath) {
                    //we need to do a double sync here: first refresh the node where the content was moved,
                    // then refresh the node where the content was moved from
                    navigationService.syncTree({
                        tree: target.nodeType ? target.nodeType : target.metaData.treeAlias,
                        path: newPath,
                        forceReload: true,
                        activate: false
                    }).then(function (args) {
                        //get the currently edited node (if any)
                        var activeNode = appState.getTreeState('selectedNode');
                        if (activeNode) {
                            navigationService.reloadNode(activeNode);
                        }
                    });
                }
            });
        }
        $scope.copy = function () {
            var copyEditor = {
                section: $scope.entityType,
                currentNode: $scope.contentId,
                submit: function submit(model) {
                    if (model.target) {
                        performCopy(model.target, model.relateToOriginal);
                    }
                    editorService.close();
                },
                close: function close() {
                    editorService.close();
                }
            };
            editorService.copy(copyEditor);
        };
        function performCopy(target, relateToOriginal) {
            applySelected(function (selected, index) {
                return contentResource.copy({
                    parentId: target.id,
                    id: getIdCallback(selected[index]),
                    relateToOriginal: relateToOriginal
                });
            }, function (count, total) {
                var key = total === 1 ? 'bulk_copiedItemOfItem' : 'bulk_copiedItemOfItems';
                return localizationService.localize(key, [
                    count,
                    total
                ]);
            }, function (total) {
                var key = total === 1 ? 'bulk_copiedItem' : 'bulk_copiedItems';
                return localizationService.localize(key, [total]);
            });
        }
        function getCustomPropertyValue(alias, properties) {
            var value = '';
            var index = 0;
            var foundAlias = false;
            for (var i = 0; i < properties.length; i++) {
                if (properties[i].alias == alias) {
                    foundAlias = true;
                    break;
                }
                index++;
            }
            if (foundAlias) {
                value = properties[index].value;
            }
            return value;
        }
        /** This ensures that the correct value is set for each item in a row, we don't want to call a function during interpolation or ng-bind as performance is really bad that way */
        function setPropertyValues(result) {
            //set the edit url
            result.editPath = createEditUrlCallback(result);
            _.each($scope.options.includeProperties, function (e, i) {
                var alias = e.alias;
                // First try to pull the value directly from the alias (e.g. updatedBy)
                var value = result[alias];
                // If this returns an object, look for the name property of that (e.g. owner.name)
                if (value === Object(value)) {
                    value = value['name'];
                }
                // If we've got nothing yet, look at a user defined property
                if (typeof value === 'undefined') {
                    value = getCustomPropertyValue(alias, result.properties);
                }
                // If we have a date, format it
                if (isDate(value)) {
                    value = value.substring(0, value.length - 3);
                }
                // set what we've got on the result
                result[alias] = value;
            });
        }
        function isDate(val) {
            if (angular.isString(val)) {
                return val.match(/^(\d{4})\-(\d{2})\-(\d{2})\ (\d{2})\:(\d{2})\:(\d{2})$/);
            }
            return false;
        }
        function initView() {
            //default to root id if the id is undefined
            var id = $routeParams.id;
            if (id === undefined) {
                id = -1;
            }
            getContentTypesCallback(id).then(function (listViewAllowedTypes) {
                $scope.listViewAllowedTypes = listViewAllowedTypes;
                var blueprints = false;
                _.each(listViewAllowedTypes, function (allowedType) {
                    if (_.isEmpty(allowedType.blueprints)) {
                        // this helps the view understand that there are no blueprints available
                        allowedType.blueprints = null;
                    } else {
                        blueprints = true;
                        // turn the content type blueprints object into an array of sortable objects for the view
                        allowedType.blueprints = _.map(_.pairs(allowedType.blueprints || {}), function (pair) {
                            return {
                                id: pair[0],
                                name: pair[1]
                            };
                        });
                    }
                });
                if (listViewAllowedTypes.length === 1 && blueprints === false) {
                    $scope.createAllowedButtonSingle = true;
                }
                if (listViewAllowedTypes.length === 1 && blueprints === true) {
                    $scope.createAllowedButtonSingleWithBlueprints = true;
                }
                if (listViewAllowedTypes.length > 1) {
                    $scope.createAllowedButtonMultiWithBlueprints = true;
                }
            });
            $scope.contentId = id;
            $scope.isTrashed = id === '-20' || id === '-21';
            $scope.options.allowBulkPublish = $scope.options.allowBulkPublish && !$scope.isTrashed;
            $scope.options.allowBulkUnpublish = $scope.options.allowBulkUnpublish && !$scope.isTrashed;
            $scope.options.bulkActionsAllowed = $scope.options.allowBulkPublish || $scope.options.allowBulkUnpublish || $scope.options.allowBulkCopy || $scope.options.allowBulkMove || $scope.options.allowBulkDelete;
            $scope.reloadView($scope.contentId);
        }
        function getLocalizedKey(alias) {
            switch (alias) {
            case 'sortOrder':
                return 'general_sort';
            case 'updateDate':
                return 'content_updateDate';
            case 'updater':
                return 'content_updatedBy';
            case 'createDate':
                return 'content_createDate';
            case 'owner':
                return 'content_createBy';
            case 'published':
                return 'content_isPublished';
            case 'contentTypeAlias':
                //TODO: Check for members
                return $scope.entityType === 'content' ? 'content_documentType' : 'content_mediatype';
            case 'email':
                return 'general_email';
            case 'username':
                return 'general_username';
            }
            return alias;
        }
        function getItemKey(itemId) {
            for (var i = 0; i < $scope.listViewResultSet.items.length; i++) {
                var item = $scope.listViewResultSet.items[i];
                if (item.id === itemId) {
                    return item.key;
                }
            }
        }
        function createBlank(entityType, docTypeAlias) {
            $location.path('/' + entityType + '/' + entityType + '/edit/' + $scope.contentId).search('doctype', docTypeAlias).search('create', 'true');
        }
        function createFromBlueprint(entityType, docTypeAlias, blueprintId) {
            $location.path('/' + entityType + '/' + entityType + '/edit/' + $scope.contentId).search('doctype', docTypeAlias).search('create', 'true').search('blueprintId', blueprintId);
        }
        $scope.createBlank = createBlank;
        $scope.createFromBlueprint = createFromBlueprint;
        //GO!
        initView();
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.ListViewController', listViewController);
    'use strict';
    (function () {
        'use strict';
        function ListViewPublishController($scope, $routeParams, localizationService) {
            var vm = this;
            vm.loading = true;
            vm.changeSelection = changeSelection;
            function changeSelection(language) {
                // disable submit button if nothing is selected
                var firstSelected = _.find(vm.languages, function (language) {
                    return language.publish;
                });
                $scope.model.disableSubmitButton = !firstSelected;
                //need to set the Save state to true if publish is true
                language.save = language.publish;
            }
            function onInit() {
                vm.languages = $scope.model.languages;
                if (!$scope.model.title) {
                    localizationService.localize('content_readyToPublish').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                // node has variants
                if (vm.languages && vm.languages.length > 0) {
                    var culture = $routeParams.cculture ? $routeParams.cculture : $routeParams.mculture;
                    if (culture) {
                        // sort languages so the active on is on top
                        vm.languages = _.sortBy(vm.languages, function (language) {
                            return language.culture === culture ? 0 : 1;
                        });
                        var active = _.find(vm.languages, function (language) {
                            return language.culture === culture;
                        });
                        if (active) {
                            //ensure that the current one is selected
                            active.publish = true;
                        }
                    }
                }
                vm.loading = false;
            }
            onInit();
            //when this dialog is closed, reset all 'publish' flags
            $scope.$on('$destroy', function () {
                if (vm.languages && vm.languages.length > 0) {
                    for (var i = 0; i < vm.languages.length; i++) {
                        vm.languages[i].publish = false;
                        vm.languages[i].save = false;
                    }
                }
            });
        }
        angular.module('umbraco').controller('Umbraco.Overlays.ListViewPublishController', ListViewPublishController);
    }());
    'use strict';
    (function () {
        'use strict';
        function ListViewUnpublishController($scope, $routeParams, localizationService) {
            var vm = this;
            vm.loading = true;
            vm.changeSelection = changeSelection;
            function changeSelection(language) {
                // disable submit button if nothing is selected
                var firstSelected = _.find(vm.languages, function (language) {
                    return language.unpublish;
                });
                $scope.model.disableSubmitButton = !firstSelected;
                //need to set the Save state to true if publish is true
                language.save = language.unpublish;
            }
            function onInit() {
                vm.languages = $scope.model.languages;
                if (!$scope.model.title) {
                    localizationService.localize('content_unpublish').then(function (value) {
                        $scope.model.title = value;
                    });
                }
                // node has variants
                if (vm.languages && vm.languages.length > 0) {
                    var culture = $routeParams.cculture ? $routeParams.cculture : $routeParams.mculture;
                    if (culture) {
                        // sort languages so the active on is on top
                        vm.languages = _.sortBy(vm.languages, function (language) {
                            return language.culture === culture ? 0 : 1;
                        });
                        var active = _.find(vm.languages, function (language) {
                            return language.culture === culture;
                        });
                        if (active) {
                            //ensure that the current one is selected
                            active.unpublish = true;
                        }
                    }
                }
                vm.loading = false;
            }
            onInit();
            //when this dialog is closed, reset all 'publish' flags
            $scope.$on('$destroy', function () {
                if (vm.languages && vm.languages.length > 0) {
                    for (var i = 0; i < vm.languages.length; i++) {
                        vm.languages[i].unpublish = false;
                        vm.languages[i].save = false;
                    }
                }
            });
        }
        angular.module('umbraco').controller('Umbraco.Overlays.ListViewUnpublishController', ListViewUnpublishController);
    }());
    'use strict';
    function sortByPreValsController($rootScope, $scope, localizationService, editorState, listViewPrevalueHelper) {
        //Get the prevalue from the correct place
        function getPrevalues() {
            if (editorState.current.preValues) {
                return editorState.current.preValues;
            } else {
                return listViewPrevalueHelper.getPrevalues();
            }
        }
        //Watch the prevalues
        $scope.$watch(function () {
            return _.findWhere(getPrevalues(), { key: 'includeProperties' }).value;
        }, function () {
            populateFields();
        }, true);
        //Use deep watching, otherwise we won't pick up header changes
        function populateFields() {
            // Helper to find a particular value from the list of sort by options
            function findFromSortByFields(value) {
                return _.find($scope.sortByFields, function (e) {
                    return e.value.toLowerCase() === value.toLowerCase();
                });
            }
            // Get list of properties assigned as columns of the list view
            var propsPreValue = _.findWhere(getPrevalues(), { key: 'includeProperties' });
            // Populate list of options for the default sort (all the columns plus then node name)
            $scope.sortByFields = [];
            $scope.sortByFields.push({
                value: 'name',
                name: 'Name',
                isSystem: 1
            });
            if (propsPreValue != undefined) {
                for (var i = 0; i < propsPreValue.value.length; i++) {
                    var value = propsPreValue.value[i];
                    $scope.sortByFields.push({
                        value: value.alias,
                        name: value.header,
                        isSystem: value.isSystem
                    });
                }
            }
            // Localize the system fields, for some reason the directive doesn't work inside of the select group with an ng-model declared
            // beware: ensure that GetDatabaseFieldNameForOrderBy knows about those fields!
            var systemFields = [
                {
                    value: 'SortOrder',
                    key: 'general_sort'
                },
                {
                    value: 'Name',
                    key: 'general_name'
                },
                {
                    value: 'VersionDate',
                    key: 'content_updateDate'
                },
                {
                    value: 'Updater',
                    key: 'content_updatedBy'
                },
                {
                    value: 'CreateDate',
                    key: 'content_createDate'
                },
                {
                    value: 'Owner',
                    key: 'content_createBy'
                },
                {
                    value: 'ContentTypeAlias',
                    key: 'content_documentType'
                },
                {
                    value: 'Published',
                    key: 'content_isPublished'
                },
                {
                    value: 'Email',
                    key: 'general_email'
                },
                {
                    value: 'Username',
                    key: 'general_username'
                }
            ];
            _.each(systemFields, function (e) {
                localizationService.localize(e.key).then(function (v) {
                    var sortByListValue = findFromSortByFields(e.value);
                    if (sortByListValue) {
                        sortByListValue.name = v;
                        switch (e.value) {
                        case 'Updater':
                            e.name += ' (Content only)';
                            break;
                        case 'Published':
                            e.name += ' (Content only)';
                            break;
                        case 'Email':
                            e.name += ' (Members only)';
                            break;
                        case 'Username':
                            e.name += ' (Members only)';
                            break;
                        }
                    }
                });
            });
            // Check existing model value is available in list and ensure a value is set
            var existingValue = findFromSortByFields($scope.model.value);
            if (existingValue) {
                // Set the existing value
                // The old implementation pre Umbraco 7.5 used PascalCase aliases, this uses camelCase, so this ensures that any previous value is set
                $scope.model.value = existingValue.value;
            } else {
                // Existing value not found, set to first value
                $scope.model.value = $scope.sortByFields[0].value;
            }
        }
    }
    angular.module('umbraco').controller('Umbraco.PrevalueEditors.SortByListViewController', sortByPreValsController);
    'use strict';
    //DO NOT DELETE THIS, this is in use... 
    angular.module('umbraco').controller('Umbraco.PropertyEditors.MacroContainerController', function ($scope, macroService) {
        $scope.renderModel = [];
        $scope.allowOpenButton = true;
        $scope.allowRemoveButton = true;
        $scope.sortableOptions = {};
        if ($scope.model.value) {
            var macros = $scope.model.value.split('>');
            angular.forEach(macros, function (syntax, key) {
                if (syntax && syntax.length > 10) {
                    //re-add the char we split on
                    syntax = syntax + '>';
                    var parsed = macroService.parseMacroSyntax(syntax);
                    if (!parsed) {
                        parsed = {};
                    }
                    parsed.syntax = syntax;
                    collectDetails(parsed);
                    $scope.renderModel.push(parsed);
                    setSortingState($scope.renderModel);
                }
            });
        }
        function collectDetails(macro) {
            macro.details = '';
            macro.icon = 'icon-settings-alt';
            if (macro.macroParamsDictionary) {
                angular.forEach(macro.macroParamsDictionary, function (value, key) {
                    macro.details += key + ': ' + value + ' ';
                });
            }
        }
        function openDialog(index) {
            var dialogData = { allowedMacros: $scope.model.config.allowed };
            if (index !== null && $scope.renderModel[index]) {
                var macro = $scope.renderModel[index];
                dialogData['macroData'] = macro;
            }
            $scope.macroPickerOverlay = {};
            $scope.macroPickerOverlay.view = 'macropicker';
            $scope.macroPickerOverlay.dialogData = dialogData;
            $scope.macroPickerOverlay.show = true;
            $scope.macroPickerOverlay.submit = function (model) {
                var macroObject = macroService.collectValueData(model.selectedMacro, model.macroParams, dialogData.renderingEngine);
                collectDetails(macroObject);
                //update the raw syntax and the list...
                if (index !== null && $scope.renderModel[index]) {
                    $scope.renderModel[index] = macroObject;
                } else {
                    $scope.renderModel.push(macroObject);
                }
                setSortingState($scope.renderModel);
                $scope.macroPickerOverlay.show = false;
                $scope.macroPickerOverlay = null;
            };
            $scope.macroPickerOverlay.close = function (oldModel) {
                $scope.macroPickerOverlay.show = false;
                $scope.macroPickerOverlay = null;
            };
        }
        $scope.edit = function (index) {
            openDialog(index);
        };
        $scope.add = function () {
            if ($scope.model.config.max && $scope.model.config.max > 0 && $scope.renderModel.length >= $scope.model.config.max) {
                //cannot add more than the max
                return;
            }
            openDialog();
        };
        $scope.remove = function (index) {
            $scope.renderModel.splice(index, 1);
            setSortingState($scope.renderModel);
        };
        $scope.clear = function () {
            $scope.model.value = '';
            $scope.renderModel = [];
        };
        var unsubscribe = $scope.$on('formSubmitting', function (ev, args) {
            var syntax = [];
            angular.forEach($scope.renderModel, function (value, key) {
                syntax.push(value.syntax);
            });
            $scope.model.value = syntax.join('');
        });
        //when the scope is destroyed we need to unsubscribe
        $scope.$on('$destroy', function () {
            unsubscribe();
        });
        function trim(str, chr) {
            var rgxtrim = !chr ? new RegExp('^\\s+|\\s+$', 'g') : new RegExp('^' + chr + '+|' + chr + '+$', 'g');
            return str.replace(rgxtrim, '');
        }
        function setSortingState(items) {
            // disable sorting if the list only consist of one item
            if (items.length > 1) {
                $scope.sortableOptions.disabled = false;
            } else {
                $scope.sortableOptions.disabled = true;
            }
        }
    });
    'use strict';
    function MacroListController($scope, entityResource) {
        $scope.items = [];
        entityResource.getAll('Macro').then(function (items) {
            _.each(items, function (i) {
                $scope.items.push({
                    name: i.name,
                    alias: i.alias
                });
            });
        });
    }
    angular.module('umbraco').controller('Umbraco.PrevalueEditors.MacroList', MacroListController);
    'use strict';
    //inject umbracos assetsServce and dialog service
    function MarkdownEditorController($scope, $element, assetsService, editorService, angularHelper, $timeout) {
        //tell the assets service to load the markdown.editor libs from the markdown editors
        //plugin folder
        if ($scope.model.value === null || $scope.model.value === '') {
            $scope.model.value = $scope.model.config.defaultValue;
        }
        // create a unique ID for the markdown editor, so the button bar bindings can handle split view
        // - must be bound on scope, not scope.model - otherwise it won't work, because $scope.model is used in both sides of the split view
        $scope.editorId = $scope.model.alias + _.uniqueId('-');
        function openMediaPicker(callback) {
            var mediaPicker = {
                disableFolderSelect: true,
                submit: function submit(model) {
                    var selectedImagePath = model.selectedImages[0].image;
                    callback(selectedImagePath);
                    editorService.close();
                },
                close: function close() {
                    editorService.close();
                }
            };
            editorService.mediaPicker(mediaPicker);
        }
        assetsService.load([
            'lib/markdown/markdown.converter.js',
            'lib/markdown/markdown.sanitizer.js',
            'lib/markdown/markdown.editor.js'
        ]).then(function () {
            // we need a short delay to wait for the textbox to appear.
            setTimeout(function () {
                //this function will execute when all dependencies have loaded
                // but in the case that they've been previously loaded, we can only
                // init the md editor after this digest because the DOM needs to be ready first
                // so run the init on a timeout
                $timeout(function () {
                    $scope.markdownEditorInitComplete = false;
                    var converter2 = new Markdown.Converter();
                    var editor2 = new Markdown.Editor(converter2, '-' + $scope.editorId);
                    editor2.run();
                    //subscribe to the image dialog clicks
                    editor2.hooks.set('insertImageDialog', function (callback) {
                        openMediaPicker(callback);
                        return true;    // tell the editor that we'll take care of getting the image url
                    });
                    editor2.hooks.set('onPreviewRefresh', function () {
                        // We must manually update the model as there is no way to hook into the markdown editor events without exstensive edits to the library.
                        if ($scope.model.value !== $('textarea', $element).val()) {
                            if ($scope.markdownEditorInitComplete) {
                                //only set dirty after init load to avoid "unsaved" dialogue when we don't want it
                                angularHelper.getCurrentForm($scope).$setDirty();
                            } else {
                                $scope.markdownEditorInitComplete = true;
                            }
                            $scope.model.value = $('textarea', $element).val();
                        }
                    });
                }, 200);
            });
            //load the seperat css for the editor to avoid it blocking our js loading TEMP HACK
            assetsService.loadCss('lib/markdown/markdown.css', $scope);
        });
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.MarkdownEditorController', MarkdownEditorController);
    'use strict';
    //this controller simply tells the dialogs service to open a mediaPicker window
    //with a specified callback, this callback will receive an object with a selection on it
    angular.module('umbraco').controller('Umbraco.PropertyEditors.MediaPickerController', function ($scope, entityResource, mediaHelper, $timeout, userService, localizationService, editorService) {
        //check the pre-values for multi-picker
        var multiPicker = $scope.model.config.multiPicker && $scope.model.config.multiPicker !== '0' ? true : false;
        var onlyImages = $scope.model.config.onlyImages && $scope.model.config.onlyImages !== '0' ? true : false;
        var disableFolderSelect = $scope.model.config.disableFolderSelect && $scope.model.config.disableFolderSelect !== '0' ? true : false;
        $scope.allowEditMedia = false;
        $scope.allowAddMedia = false;
        function setupViewModel() {
            $scope.mediaItems = [];
            $scope.ids = [];
            $scope.isMultiPicker = multiPicker;
            if ($scope.model.value) {
                var ids = $scope.model.value.split(',');
                //NOTE: We need to use the entityResource NOT the mediaResource here because
                // the mediaResource has server side auth configured for which the user must have
                // access to the media section, if they don't they'll get auth errors. The entityResource
                // acts differently in that it allows access if the user has access to any of the apps that
                // might require it's use. Therefore we need to use the metaData property to get at the thumbnail
                // value.
                entityResource.getByIds(ids, 'Media').then(function (medias) {
                    // The service only returns item results for ids that exist (deleted items are silently ignored).
                    // This results in the picked items value to be set to contain only ids of picked items that could actually be found.
                    // Since a referenced item could potentially be restored later on, instead of changing the selected values here based
                    // on whether the items exist during a save event - we should keep "placeholder" items for picked items that currently
                    // could not be fetched. This will preserve references and ensure that the state of an item does not differ depending
                    // on whether it is simply resaved or not.
                    // This is done by remapping the int/guid ids into a new array of items, where we create "Deleted item" placeholders
                    // when there is no match for a selected id. This will ensure that the values being set on save, are the same as before.
                    medias = _.map(ids, function (id) {
                        var found = _.find(medias, function (m) {
                            // We could use coercion (two ='s) here .. but not sure if this works equally well in all browsers and
                            // it's prone to someone "fixing" it at some point without knowing the effects. Rather use toString()
                            // compares and be completely sure it works.
                            return m.udi.toString() === id.toString() || m.id.toString() === id.toString();
                        });
                        if (found) {
                            return found;
                        } else {
                            return {
                                name: localizationService.dictionary.mediaPicker_deletedItem,
                                id: $scope.model.config.idType !== 'udi' ? id : null,
                                udi: $scope.model.config.idType === 'udi' ? id : null,
                                icon: 'icon-picture',
                                thumbnail: null,
                                trashed: true
                            };
                        }
                    });
                    _.each(medias, function (media, i) {
                        // if there is no thumbnail, try getting one if the media is not a placeholder item
                        if (!media.thumbnail && media.id && media.metaData) {
                            media.thumbnail = mediaHelper.resolveFileFromEntity(media, true);
                        }
                        $scope.mediaItems.push(media);
                        if ($scope.model.config.idType === 'udi') {
                            $scope.ids.push(media.udi);
                        } else {
                            $scope.ids.push(media.id);
                        }
                    });
                    sync();
                });
            }
        }
        function sync() {
            $scope.model.value = $scope.ids.join();
        }
        ;
        function reloadUpdatedMediaItems(updatedMediaNodes) {
            // because the images can be edited through the media picker we need to 
            // reload. We only reload the images that is already picked but has been updated.
            // We have to get the entities from the server because the media 
            // can be edited without being selected
            _.each($scope.images, function (image, i) {
                if (updatedMediaNodes.indexOf(image.udi) !== -1) {
                    image.loading = true;
                    entityResource.getById(image.udi, 'media').then(function (mediaEntity) {
                        angular.extend(image, mediaEntity);
                        image.thumbnail = mediaHelper.resolveFileFromEntity(image, true);
                        image.loading = false;
                    });
                }
            });
        }
        function init() {
            userService.getCurrentUser().then(function (userData) {
                if (!$scope.model.config.startNodeId) {
                    $scope.model.config.startNodeId = userData.startMediaIds.length !== 1 ? -1 : userData.startMediaIds[0];
                    $scope.model.config.startNodeIsVirtual = userData.startMediaIds.length !== 1;
                }
                // only allow users to add and edit media if they have access to the media section
                var hasAccessToMedia = userData.allowedSections.indexOf('media') !== -1;
                $scope.allowEditMedia = hasAccessToMedia;
                $scope.allowAddMedia = hasAccessToMedia;
                setupViewModel();
                //When the model value changes sync the view model
                $scope.$watch('model.value', function (newVal, oldVal) {
                    if (newVal !== oldVal) {
                        setupViewModel();
                    }
                });
            });
        }
        $scope.remove = function (index) {
            $scope.mediaItems.splice(index, 1);
            $scope.ids.splice(index, 1);
            sync();
        };
        $scope.editItem = function (item) {
            var mediaEditor = {
                id: item.id,
                submit: function submit(model) {
                    editorService.close();
                    // update the selected media item to match the saved media item
                    // the media picker is using media entities so we get the
                    // entity so we easily can format it for use in the media grid
                    if (model && model.mediaNode) {
                        entityResource.getById(model.mediaNode.id, 'media').then(function (mediaEntity) {
                            // if an image is selecting more than once 
                            // we need to update all the media items
                            angular.forEach($scope.images, function (image) {
                                if (image.id === model.mediaNode.id) {
                                    angular.extend(image, mediaEntity);
                                    image.thumbnail = mediaHelper.resolveFileFromEntity(image, true);
                                }
                            });
                        });
                    }
                },
                close: function close(model) {
                    editorService.close();
                }
            };
            editorService.mediaEditor(mediaEditor);
        };
        $scope.add = function () {
            var mediaPicker = {
                startNodeId: $scope.model.config.startNodeId,
                startNodeIsVirtual: $scope.model.config.startNodeIsVirtual,
                multiPicker: multiPicker,
                onlyImages: onlyImages,
                disableFolderSelect: disableFolderSelect,
                allowMediaEdit: true,
                submit: function submit(model) {
                    editorService.close();
                    _.each(model.selectedImages, function (media, i) {
                        // if there is no thumbnail, try getting one if the media is not a placeholder item
                        if (!media.thumbnail && media.id && media.metaData) {
                            media.thumbnail = mediaHelper.resolveFileFromEntity(media, true);
                        }
                        $scope.mediaItems.push(media);
                        if ($scope.model.config.idType === 'udi') {
                            $scope.ids.push(media.udi);
                        } else {
                            $scope.ids.push(media.id);
                        }
                    });
                    sync();
                    reloadUpdatedMediaItems(model.updatedMediaNodes);
                },
                close: function close(model) {
                    editorService.close();
                    reloadUpdatedMediaItems(model.updatedMediaNodes);
                }
            };
            editorService.mediaPicker(mediaPicker);
        };
        $scope.sortableOptions = {
            disabled: !$scope.isMultiPicker,
            items: 'li:not(.add-wrapper)',
            cancel: '.unsortable',
            update: function update(e, ui) {
                var r = [];
                // TODO: Instead of doing this with a half second delay would be better to use a watch like we do in the
                // content picker. Then we don't have to worry about setting ids, render models, models, we just set one and let the
                // watch do all the rest.
                $timeout(function () {
                    angular.forEach($scope.mediaItems, function (value, key) {
                        r.push($scope.model.config.idType === 'udi' ? value.udi : value.id);
                    });
                    $scope.ids = r;
                    sync();
                }, 500, false);
            }
        };
        $scope.showAdd = function () {
            if (!multiPicker) {
                if ($scope.model.value && $scope.model.value !== '') {
                    return false;
                }
            }
            return true;
        };
        init();
    });
    'use strict';
    //this controller simply tells the dialogs service to open a memberPicker window
    //with a specified callback, this callback will receive an object with a selection on it
    function memberGroupPicker($scope, editorService, memberGroupResource) {
        function trim(str, chr) {
            var rgxtrim = !chr ? new RegExp('^\\s+|\\s+$', 'g') : new RegExp('^' + chr + '+|' + chr + '+$', 'g');
            return str.replace(rgxtrim, '');
        }
        $scope.renderModel = [];
        $scope.allowRemove = true;
        $scope.groupIds = [];
        if ($scope.model.value) {
            var groupIds = $scope.model.value.split(',');
            memberGroupResource.getByIds(groupIds).then(function (groups) {
                $scope.renderModel = groups;
            });
        }
        $scope.openMemberGroupPicker = function () {
            var memberGroupPicker = {
                multiPicker: true,
                submit: function submit(model) {
                    var selectedGroupIds = _.map(model.selectedMemberGroups ? model.selectedMemberGroups : [model.selectedMemberGroup], function (id) {
                        return parseInt(id);
                    });
                    // figure out which groups are new and fetch them
                    var newGroupIds = _.difference(selectedGroupIds, renderModelIds());
                    if (newGroupIds && newGroupIds.length) {
                        memberGroupResource.getByIds(newGroupIds).then(function (groups) {
                            $scope.renderModel = _.union($scope.renderModel, groups);
                            editorService.close();
                        });
                    } else {
                        // no new groups selected
                        editorService.close();
                    }
                    editorService.close();
                },
                close: function close() {
                    editorService.close();
                }
            };
            editorService.memberGroupPicker(memberGroupPicker);
        };
        $scope.remove = function (index) {
            $scope.renderModel.splice(index, 1);
        };
        $scope.add = function (item) {
            var currIds = _.map($scope.renderModel, function (i) {
                return i.id;
            });
            if (currIds.indexOf(item) < 0) {
                $scope.renderModel.push({
                    name: item,
                    id: item,
                    icon: 'icon-users'
                });
            }
        };
        $scope.clear = function () {
            $scope.renderModel = [];
        };
        function renderModelIds() {
            return _.map($scope.renderModel, function (i) {
                return i.id;
            });
        }
        var unsubscribe = $scope.$on('formSubmitting', function (ev, args) {
            $scope.model.value = trim(renderModelIds().join(), ',');
        });
        //when the scope is destroyed we need to unsubscribe
        $scope.$on('$destroy', function () {
            unsubscribe();
        });
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.MemberGroupPickerController', memberGroupPicker);
    'use strict';
    function memberGroupController($scope, editorService, memberGroupResource) {
        //set the selected to the keys of the dictionary who's value is true
        $scope.getSelected = function () {
            var selected = [];
            for (var n in $scope.model.value) {
                if ($scope.model.value[n] === true) {
                    selected.push(n);
                }
            }
            return selected;
        };
        $scope.pickGroup = function () {
            editorService.memberGroupPicker({
                multiPicker: true,
                submit: function submit(model) {
                    var selectedGroupIds = _.map(model.selectedMemberGroups ? model.selectedMemberGroups : [model.selectedMemberGroup], function (id) {
                        return parseInt(id);
                    });
                    memberGroupResource.getByIds(selectedGroupIds).then(function (selectedGroups) {
                        _.each(selectedGroups, function (group) {
                            $scope.model.value[group.name] = true;
                        });
                    });
                    editorService.close();
                },
                close: function close() {
                    editorService.close();
                }
            });
        };
        $scope.removeGroup = function (group) {
            $scope.model.value[group] = false;
        };
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.MemberGroupController', memberGroupController);
    'use strict';
    //this controller simply tells the dialogs service to open a memberPicker window
    //with a specified callback, this callback will receive an object with a selection on it
    function memberPickerController($scope, entityResource, iconHelper, angularHelper, editorService) {
        function trim(str, chr) {
            var rgxtrim = !chr ? new RegExp('^\\s+|\\s+$', 'g') : new RegExp('^' + chr + '+|' + chr + '+$', 'g');
            return str.replace(rgxtrim, '');
        }
        $scope.renderModel = [];
        $scope.allowRemove = true;
        var dialogOptions = {
            multiPicker: false,
            entityType: 'Member',
            section: 'member',
            treeAlias: 'member',
            filter: function filter(i) {
                return i.metaData.isContainer == true;
            },
            filterCssClass: 'not-allowed',
            callback: function callback(data) {
                if (angular.isArray(data)) {
                    _.each(data, function (item, i) {
                        $scope.add(item);
                    });
                } else {
                    $scope.clear();
                    $scope.add(data);
                }
                angularHelper.getCurrentForm($scope).$setDirty();
            }
        };
        //since most of the pre-value config's are used in the dialog options (i.e. maxNumber, minNumber, etc...) we'll merge the
        // pre-value config on to the dialog options
        if ($scope.model.config) {
            angular.extend(dialogOptions, $scope.model.config);
        }
        $scope.openMemberPicker = function () {
            var memberPicker = dialogOptions;
            memberPicker.submit = function (model) {
                if (model.selection) {
                    _.each(model.selection, function (item, i) {
                        $scope.add(item);
                    });
                }
                editorService.close();
            };
            memberPicker.close = function () {
                editorService.close();
            };
            editorService.treePicker(memberPicker);
        };
        $scope.remove = function (index) {
            $scope.renderModel.splice(index, 1);
        };
        $scope.add = function (item) {
            var currIds = _.map($scope.renderModel, function (i) {
                if ($scope.model.config.idType === 'udi') {
                    return i.udi;
                } else {
                    return i.id;
                }
            });
            var itemId = $scope.model.config.idType === 'udi' ? item.udi : item.id;
            if (currIds.indexOf(itemId) < 0) {
                item.icon = iconHelper.convertFromLegacyIcon(item.icon);
                $scope.renderModel.push({
                    name: item.name,
                    id: item.id,
                    udi: item.udi,
                    icon: item.icon
                });
            }
        };
        $scope.clear = function () {
            $scope.renderModel = [];
        };
        var unsubscribe = $scope.$on('formSubmitting', function (ev, args) {
            var currIds = _.map($scope.renderModel, function (i) {
                if ($scope.model.config.idType === 'udi') {
                    return i.udi;
                } else {
                    return i.id;
                }
            });
            $scope.model.value = trim(currIds.join(), ',');
        });
        //when the scope is destroyed we need to unsubscribe
        $scope.$on('$destroy', function () {
            unsubscribe();
        });
        //load member data
        var modelIds = $scope.model.value ? $scope.model.value.split(',') : [];
        entityResource.getByIds(modelIds, 'Member').then(function (data) {
            _.each(data, function (item, i) {
                // set default icon if it's missing
                item.icon = item.icon ? iconHelper.convertFromLegacyIcon(item.icon) : 'icon-user';
                $scope.renderModel.push({
                    name: item.name,
                    id: item.id,
                    udi: item.udi,
                    icon: item.icon
                });
            });
        });
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.MemberPickerController', memberPickerController);
    'use strict';
    function MultipleTextBoxController($scope, $timeout) {
        var backspaceHits = 0;
        // Set the visible prompt to -1 to ensure it will not be visible
        $scope.promptIsVisible = '-1';
        $scope.sortableOptions = {
            axis: 'y',
            containment: 'parent',
            cursor: 'move',
            items: '> div.textbox-wrapper',
            tolerance: 'pointer'
        };
        if (!$scope.model.value) {
            $scope.model.value = [];
        }
        //add any fields that there isn't values for
        if ($scope.model.config.min > 0) {
            for (var i = 0; i < $scope.model.config.min; i++) {
                if (i + 1 > $scope.model.value.length) {
                    $scope.model.value.push({ value: '' });
                }
            }
        }
        $scope.addRemoveOnKeyDown = function (event, index) {
            var txtBoxValue = $scope.model.value[index];
            event.preventDefault();
            switch (event.keyCode) {
            case 13:
                if ($scope.model.config.max <= 0 && txtBoxValue.value || $scope.model.value.length < $scope.model.config.max && txtBoxValue.value) {
                    var newItemIndex = index + 1;
                    $scope.model.value.splice(newItemIndex, 0, { value: '' });
                    //Focus on the newly added value
                    $scope.model.value[newItemIndex].hasFocus = true;
                }
                break;
            case 8:
                if ($scope.model.value.length > $scope.model.config.min) {
                    var remainder = [];
                    // Used to require an extra hit on backspace for the field to be removed
                    if (txtBoxValue.value === '') {
                        backspaceHits++;
                    } else {
                        backspaceHits = 0;
                    }
                    if (txtBoxValue.value === '' && backspaceHits === 2) {
                        for (var x = 0; x < $scope.model.value.length; x++) {
                            if (x !== index) {
                                remainder.push($scope.model.value[x]);
                            }
                        }
                        $scope.model.value = remainder;
                        var prevItemIndex = index - 1;
                        //Set focus back on false as the directive only watches for true
                        if (prevItemIndex >= 0) {
                            $scope.model.value[prevItemIndex].hasFocus = false;
                            $timeout(function () {
                                //Focus on the previous value
                                $scope.model.value[prevItemIndex].hasFocus = true;
                            });
                        }
                        backspaceHits = 0;
                    }
                }
                break;
            default:
            }
        };
        $scope.add = function () {
            if ($scope.model.config.max <= 0 || $scope.model.value.length < $scope.model.config.max) {
                $scope.model.value.push({ value: '' });
                // focus new value
                var newItemIndex = $scope.model.value.length - 1;
                $scope.model.value[newItemIndex].hasFocus = true;
            }
        };
        $scope.remove = function (index) {
            // Make sure not to trigger other prompts when remove is triggered
            $scope.hidePrompt();
            var remainder = [];
            for (var x = 0; x < $scope.model.value.length; x++) {
                if (x !== index) {
                    remainder.push($scope.model.value[x]);
                }
            }
            $scope.model.value = remainder;
        };
        $scope.showPrompt = function (idx, item) {
            var i = $scope.model.value.indexOf(item);
            // Make the prompt visible for the clicked tag only
            if (i === idx) {
                $scope.promptIsVisible = i;
            }
        };
        $scope.hidePrompt = function () {
            $scope.promptIsVisible = '-1';
        };
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.MultipleTextBoxController', MultipleTextBoxController);
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.NestedContent.DocTypePickerController', [
        '$scope',
        'Umbraco.PropertyEditors.NestedContent.Resources',
        function ($scope, ncResources) {
            $scope.add = function () {
                $scope.model.value.push({
                    // As per PR #4, all stored content type aliases must be prefixed "nc" for easier recognition.
                    // For good measure we'll also prefix the tab alias "nc"
                    ncAlias: '',
                    ncTabAlias: '',
                    nameTemplate: ''
                });
            };
            $scope.remove = function (index) {
                $scope.model.value.splice(index, 1);
            };
            $scope.sortableOptions = {
                axis: 'y',
                cursor: 'move',
                handle: '.icon-navigation'
            };
            $scope.docTypeTabs = {};
            ncResources.getContentTypes().then(function (docTypes) {
                $scope.model.docTypes = docTypes;
                // Populate document type tab dictionary
                docTypes.forEach(function (value) {
                    $scope.docTypeTabs[value.alias] = value.tabs;
                });
            });
            $scope.selectableDocTypesFor = function (config) {
                // return all doctypes that are:
                // 1. either already selected for this config, or
                // 2. not selected in any other config
                return _.filter($scope.model.docTypes, function (docType) {
                    return docType.alias === config.ncAlias || !_.find($scope.model.value, function (c) {
                        return docType.alias === c.ncAlias;
                    });
                });
            };
            if (!$scope.model.value) {
                $scope.model.value = [];
                $scope.add();
            }
        }
    ]);
    angular.module('umbraco').controller('Umbraco.PropertyEditors.NestedContent.PropertyEditorController', [
        '$scope',
        '$interpolate',
        '$filter',
        '$timeout',
        'contentResource',
        'localizationService',
        'iconHelper',
        function ($scope, $interpolate, $filter, $timeout, contentResource, localizationService, iconHelper) {
            //$scope.model.config.contentTypes;
            //$scope.model.config.minItems;
            //$scope.model.config.maxItems;
            //console.log($scope);
            var inited = false;
            _.each($scope.model.config.contentTypes, function (contentType) {
                contentType.nameExp = !!contentType.nameTemplate ? $interpolate(contentType.nameTemplate) : undefined;
            });
            $scope.editIconTitle = '';
            $scope.moveIconTitle = '';
            $scope.deleteIconTitle = '';
            // localize the edit icon title
            localizationService.localize('general_edit').then(function (value) {
                $scope.editIconTitle = value;
            });
            // localize the delete icon title
            localizationService.localize('general_delete').then(function (value) {
                $scope.deleteIconTitle = value;
            });
            // localize the move icon title
            localizationService.localize('actions_move').then(function (value) {
                $scope.moveIconTitle = value;
            });
            $scope.nodes = [];
            $scope.currentNode = undefined;
            $scope.realCurrentNode = undefined;
            $scope.scaffolds = undefined;
            $scope.sorting = false;
            $scope.minItems = $scope.model.config.minItems || 0;
            $scope.maxItems = $scope.model.config.maxItems || 0;
            if ($scope.maxItems == 0)
                $scope.maxItems = 1000;
            $scope.singleMode = $scope.minItems == 1 && $scope.maxItems == 1;
            $scope.showIcons = $scope.model.config.showIcons || true;
            $scope.wideMode = $scope.model.config.hideLabel == '1';
            // helper to force the current form into the dirty state
            $scope.setDirty = function () {
                if ($scope.propertyForm) {
                    $scope.propertyForm.$setDirty();
                }
            };
            $scope.addNode = function (alias) {
                var scaffold = $scope.getScaffold(alias);
                var newNode = initNode(scaffold, null);
                $scope.currentNode = newNode;
                $scope.setDirty();
            };
            $scope.openNodeTypePicker = function ($event) {
                if ($scope.nodes.length >= $scope.maxItems) {
                    return;
                }
                $scope.overlayMenu = {
                    title: localizationService.localize('grid_insertControl'),
                    show: false,
                    style: {},
                    filter: $scope.scaffolds.length > 15 ? true : false,
                    view: 'itempicker',
                    event: $event,
                    submit: function submit(model) {
                        if (model && model.selectedItem) {
                            $scope.addNode(model.selectedItem.alias);
                        }
                        $scope.overlayMenu.show = false;
                        $scope.overlayMenu = null;
                    },
                    close: function close() {
                        $scope.overlayMenu.show = false;
                        $scope.overlayMenu = null;
                    }
                };
                // this could be used for future limiting on node types
                $scope.overlayMenu.availableItems = [];
                _.each($scope.scaffolds, function (scaffold) {
                    $scope.overlayMenu.availableItems.push({
                        alias: scaffold.contentTypeAlias,
                        name: scaffold.contentTypeName,
                        icon: iconHelper.convertFromLegacyIcon(scaffold.icon)
                    });
                });
                if ($scope.overlayMenu.availableItems.length === 0) {
                    return;
                }
                if ($scope.overlayMenu.availableItems.length === 1) {
                    // only one scaffold type - no need to display the picker
                    $scope.addNode($scope.scaffolds[0].contentTypeAlias);
                    return;
                }
                $scope.overlayMenu.show = true;
            };
            $scope.editNode = function (idx) {
                if ($scope.currentNode && $scope.currentNode.key == $scope.nodes[idx].key) {
                    $scope.currentNode = undefined;
                } else {
                    $scope.currentNode = $scope.nodes[idx];
                }
            };
            $scope.deleteNode = function (idx) {
                if ($scope.nodes.length > $scope.model.config.minItems) {
                    if ($scope.model.config.confirmDeletes && $scope.model.config.confirmDeletes == 1) {
                        localizationService.localize('content_nestedContentDeleteItem').then(function (value) {
                            if (confirm(value)) {
                                $scope.nodes.splice(idx, 1);
                                $scope.setDirty();
                                updateModel();
                            }
                        });
                    } else {
                        $scope.nodes.splice(idx, 1);
                        $scope.setDirty();
                        updateModel();
                    }
                }
            };
            $scope.getName = function (idx) {
                var name = 'Item ' + (idx + 1);
                if ($scope.model.value[idx]) {
                    var contentType = $scope.getContentTypeConfig($scope.model.value[idx].ncContentTypeAlias);
                    if (contentType != null && contentType.nameExp) {
                        // Run the expression against the stored dictionary value, NOT the node object
                        var item = $scope.model.value[idx];
                        // Add a temporary index property
                        item['$index'] = idx + 1;
                        var newName = contentType.nameExp(item);
                        if (newName && (newName = $.trim(newName))) {
                            name = newName;
                        }
                        // Delete the index property as we don't want to persist it
                        delete item['$index'];
                    }
                }
                // Update the nodes actual name value
                if ($scope.nodes[idx].name !== name) {
                    $scope.nodes[idx].name = name;
                }
                return name;
            };
            $scope.getIcon = function (idx) {
                var scaffold = $scope.getScaffold($scope.model.value[idx].ncContentTypeAlias);
                return scaffold && scaffold.icon ? iconHelper.convertFromLegacyIcon(scaffold.icon) : 'icon-folder';
            };
            $scope.sortableOptions = {
                axis: 'y',
                cursor: 'move',
                handle: '.umb-nested-content__icon--move',
                start: function start(ev, ui) {
                    updateModel();
                    // Yea, yea, we shouldn't modify the dom, sue me
                    $('#umb-nested-content--' + $scope.model.id + ' .umb-rte textarea').each(function () {
                        tinymce.execCommand('mceRemoveEditor', false, $(this).attr('id'));
                        $(this).css('visibility', 'hidden');
                    });
                    $scope.$apply(function () {
                        $scope.sorting = true;
                    });
                },
                update: function update(ev, ui) {
                    $scope.setDirty();
                },
                stop: function stop(ev, ui) {
                    $('#umb-nested-content--' + $scope.model.id + ' .umb-rte textarea').each(function () {
                        tinymce.execCommand('mceAddEditor', true, $(this).attr('id'));
                        $(this).css('visibility', 'visible');
                    });
                    $scope.$apply(function () {
                        $scope.sorting = false;
                        updateModel();
                    });
                }
            };
            $scope.getScaffold = function (alias) {
                return _.find($scope.scaffolds, function (scaffold) {
                    return scaffold.contentTypeAlias == alias;
                });
            };
            $scope.getContentTypeConfig = function (alias) {
                return _.find($scope.model.config.contentTypes, function (contentType) {
                    return contentType.ncAlias == alias;
                });
            };
            var notSupported = [
                'Umbraco.Tags',
                'Umbraco.UploadField',
                'Umbraco.ImageCropper'
            ];
            // Initialize
            var scaffoldsLoaded = 0;
            $scope.scaffolds = [];
            _.each($scope.model.config.contentTypes, function (contentType) {
                contentResource.getScaffold(-20, contentType.ncAlias).then(function (scaffold) {
                    // remove all tabs except the specified tab
                    var tabs = scaffold.variants[0].tabs;
                    var tab = _.find(tabs, function (tab) {
                        return tab.id != 0 && (tab.alias.toLowerCase() == contentType.ncTabAlias.toLowerCase() || contentType.ncTabAlias == '');
                    });
                    scaffold.tabs = [];
                    if (tab) {
                        scaffold.tabs.push(tab);
                        angular.forEach(tab.properties, function (property) {
                            if (_.find(notSupported, function (x) {
                                    return x === property.editor;
                                })) {
                                property.notSupported = true;
                                //TODO: Not supported message to be replaced with 'content_nestedContentEditorNotSupported' dictionary key. Currently not possible due to async/timing quirk.
                                property.notSupportedMessage = 'Property ' + property.label + ' uses editor ' + property.editor + ' which is not supported by Nested Content.';
                            }
                        });
                    }
                    // Store the scaffold object
                    $scope.scaffolds.push(scaffold);
                    scaffoldsLoaded++;
                    initIfAllScaffoldsHaveLoaded();
                }, function (error) {
                    scaffoldsLoaded++;
                    initIfAllScaffoldsHaveLoaded();
                });
            });
            var initIfAllScaffoldsHaveLoaded = function initIfAllScaffoldsHaveLoaded() {
                // Initialize when all scaffolds have loaded
                if ($scope.model.config.contentTypes.length == scaffoldsLoaded) {
                    // Because we're loading the scaffolds async one at a time, we need to
                    // sort them explicitly according to the sort order defined by the data type.
                    var contentTypeAliases = [];
                    _.each($scope.model.config.contentTypes, function (contentType) {
                        contentTypeAliases.push(contentType.ncAlias);
                    });
                    $scope.scaffolds = $filter('orderBy')($scope.scaffolds, function (s) {
                        return contentTypeAliases.indexOf(s.contentTypeAlias);
                    });
                    // Convert stored nodes
                    if ($scope.model.value) {
                        for (var i = 0; i < $scope.model.value.length; i++) {
                            var item = $scope.model.value[i];
                            var scaffold = $scope.getScaffold(item.ncContentTypeAlias);
                            if (scaffold == null) {
                                // No such scaffold - the content type might have been deleted. We need to skip it.
                                continue;
                            }
                            initNode(scaffold, item);
                        }
                    }
                    // Enforce min items
                    if ($scope.nodes.length < $scope.model.config.minItems) {
                        for (var i = $scope.nodes.length; i < $scope.model.config.minItems; i++) {
                            $scope.addNode($scope.scaffolds[0].contentTypeAlias);
                        }
                    }
                    // If there is only one item, set it as current node
                    if ($scope.singleMode || $scope.nodes.length == 1 && $scope.maxItems == 1) {
                        $scope.currentNode = $scope.nodes[0];
                    }
                    inited = true;
                }
            };
            var initNode = function initNode(scaffold, item) {
                var node = angular.copy(scaffold);
                node.key = item && item.key ? item.key : UUID.generate();
                node.ncContentTypeAlias = scaffold.contentTypeAlias;
                for (var t = 0; t < node.tabs.length; t++) {
                    var tab = node.tabs[t];
                    for (var p = 0; p < tab.properties.length; p++) {
                        var prop = tab.properties[p];
                        prop.propertyAlias = prop.alias;
                        prop.alias = $scope.model.alias + '___' + prop.alias;
                        // Force validation to occur server side as this is the
                        // only way we can have consistancy between mandatory and
                        // regex validation messages. Not ideal, but it works.
                        prop.validation = {
                            mandatory: false,
                            pattern: ''
                        };
                        if (item) {
                            if (item[prop.propertyAlias]) {
                                prop.value = item[prop.propertyAlias];
                            }
                        }
                    }
                }
                $scope.nodes.push(node);
                return node;
            };
            var updateModel = function updateModel() {
                if ($scope.realCurrentNode) {
                    $scope.$broadcast('ncSyncVal', { key: $scope.realCurrentNode.key });
                }
                if (inited) {
                    var newValues = [];
                    for (var i = 0; i < $scope.nodes.length; i++) {
                        var node = $scope.nodes[i];
                        var newValue = {
                            key: node.key,
                            name: node.name,
                            ncContentTypeAlias: node.ncContentTypeAlias
                        };
                        for (var t = 0; t < node.tabs.length; t++) {
                            var tab = node.tabs[t];
                            for (var p = 0; p < tab.properties.length; p++) {
                                var prop = tab.properties[p];
                                if (typeof prop.value !== 'function') {
                                    newValue[prop.propertyAlias] = prop.value;
                                }
                            }
                        }
                        newValues.push(newValue);
                    }
                    $scope.model.value = newValues;
                }
            };
            $scope.$watch('currentNode', function (newVal) {
                updateModel();
                $scope.realCurrentNode = newVal;
            });
            var unsubscribe = $scope.$on('formSubmitting', function (ev, args) {
                updateModel();
            });
            $scope.$on('$destroy', function () {
                unsubscribe();
            });
            //TODO: Move this into a shared location?
            var UUID = function () {
                var self = {};
                var lut = [];
                for (var i = 0; i < 256; i++) {
                    lut[i] = (i < 16 ? '0' : '') + i.toString(16);
                }
                self.generate = function () {
                    var d0 = Math.random() * 4294967295 | 0;
                    var d1 = Math.random() * 4294967295 | 0;
                    var d2 = Math.random() * 4294967295 | 0;
                    var d3 = Math.random() * 4294967295 | 0;
                    return lut[d0 & 255] + lut[d0 >> 8 & 255] + lut[d0 >> 16 & 255] + lut[d0 >> 24 & 255] + '-' + lut[d1 & 255] + lut[d1 >> 8 & 255] + '-' + lut[d1 >> 16 & 15 | 64] + lut[d1 >> 24 & 255] + '-' + lut[d2 & 63 | 128] + lut[d2 >> 8 & 255] + '-' + lut[d2 >> 16 & 255] + lut[d2 >> 24 & 255] + lut[d3 & 255] + lut[d3 >> 8 & 255] + lut[d3 >> 16 & 255] + lut[d3 >> 24 & 255];
                };
                return self;
            }();
        }
    ]);
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.RadioButtonsController', function ($scope) {
        function init() {
            //we can't really do anything if the config isn't an object
            if (angular.isObject($scope.model.config.items)) {
                //now we need to format the items in the dictionary because we always want to have an array
                var configItems = [];
                var vals = _.values($scope.model.config.items);
                var keys = _.keys($scope.model.config.items);
                for (var i = 0; i < vals.length; i++) {
                    configItems.push({
                        id: keys[i],
                        sortOrder: vals[i].sortOrder,
                        value: vals[i].value
                    });
                }
                //ensure the items are sorted by the provided sort order
                configItems.sort(function (a, b) {
                    return a.sortOrder > b.sortOrder ? 1 : b.sortOrder > a.sortOrder ? -1 : 0;
                });
                $scope.configItems = configItems;
            }
            $scope.htmlId = 'radiobuttons-' + $scope.model.alias + String.CreateGuid();
        }
        init();
    });
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.ReadOnlyValueController
 * @function
 * 
 * @description
 * The controller for the readonlyvalue property editor. 
 *  This controller offer more functionality than just a simple label as it will be able to apply formatting to the 
 *  value to be displayed. This means that we also have to apply more complex logic of watching the model value when 
 *  it changes because we are creating a new scope value called displayvalue which will never change based on the server data.
 *  In some cases after a form submission, the server will modify the data that has been persisted, especially in the cases of 
 *  readonlyvalues so we need to ensure that after the form is submitted that the new data is reflected here.
*/
    function ReadOnlyValueController($rootScope, $scope, $filter) {
        function formatDisplayValue() {
            if ($scope.model.config && angular.isArray($scope.model.config) && $scope.model.config.length > 0 && $scope.model.config[0] && $scope.model.config.filter) {
                if ($scope.model.config.format) {
                    $scope.displayvalue = $filter($scope.model.config.filter)($scope.model.value, $scope.model.config.format);
                } else {
                    $scope.displayvalue = $filter($scope.model.config.filter)($scope.model.value);
                }
            } else {
                $scope.displayvalue = $scope.model.value;
            }
        }
        //format the display value on init:
        formatDisplayValue();
        $scope.$watch('model.value', function (newVal, oldVal) {
            //cannot just check for !newVal because it might be an empty string which we 
            //want to look for.
            if (newVal !== null && newVal !== undefined && newVal !== oldVal) {
                //update the display val again
                formatDisplayValue();
            }
        });
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.ReadOnlyValueController', ReadOnlyValueController);
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.RelatedLinksController', function ($scope, iconHelper, editorService) {
        if (!$scope.model.value) {
            $scope.model.value = [];
        }
        $scope.model.config.max = isNumeric($scope.model.config.max) && $scope.model.config.max !== 0 ? $scope.model.config.max : Number.MAX_VALUE;
        $scope.newCaption = '';
        $scope.newLink = 'http://';
        $scope.newNewWindow = false;
        $scope.newInternal = null;
        $scope.newInternalName = '';
        $scope.newInternalIcon = null;
        $scope.addExternal = true;
        $scope.currentEditLink = null;
        $scope.hasError = false;
        $scope.internal = function ($event) {
            $scope.currentEditLink = null;
            var contentPicker = {
                section: 'content',
                treeAlias: 'content',
                multiPicker: false,
                idType: $scope.model.config.idType ? $scope.model.config.idType : 'int',
                submit: function submit(model) {
                    select(model.selection[0]);
                    editorService.close();
                },
                close: function close() {
                    editorService.close();
                }
            };
            editorService.treePicker(contentPicker);
            $event.preventDefault();
        };
        $scope.selectInternal = function ($event, link) {
            $scope.currentEditLink = link;
            var contentPicker = {
                section: 'content',
                treeAlias: 'content',
                multiPicker: false,
                idType: $scope.model.config.idType ? $scope.model.config.idType : 'int',
                submit: function submit(model) {
                    select(model.selection[0]);
                    editorService.close();
                },
                close: function close() {
                    editorService.close();
                }
            };
            editorService.treePicker(contentPicker);
            $event.preventDefault();
        };
        $scope.edit = function (idx) {
            for (var i = 0; i < $scope.model.value.length; i++) {
                $scope.model.value[i].edit = false;
            }
            $scope.model.value[idx].edit = true;
        };
        $scope.saveEdit = function (idx) {
            $scope.model.value[idx].title = $scope.model.value[idx].caption;
            $scope.model.value[idx].edit = false;
        };
        $scope.delete = function (idx) {
            $scope.model.value.splice(idx, 1);
        };
        $scope.add = function ($event) {
            if (!angular.isArray($scope.model.value)) {
                $scope.model.value = [];
            }
            if ($scope.newCaption == '') {
                $scope.hasError = true;
            } else {
                if ($scope.addExternal) {
                    var newExtLink = new function () {
                        this.caption = $scope.newCaption;
                        this.link = $scope.newLink;
                        this.newWindow = $scope.newNewWindow;
                        this.edit = false;
                        this.isInternal = false;
                        this.type = 'external';
                        this.title = $scope.newCaption;
                    }();
                    $scope.model.value.push(newExtLink);
                } else {
                    var newIntLink = new function () {
                        this.caption = $scope.newCaption;
                        this.link = $scope.newInternal;
                        this.newWindow = $scope.newNewWindow;
                        this.internal = $scope.newInternal;
                        this.edit = false;
                        this.isInternal = true;
                        this.internalName = $scope.newInternalName;
                        this.internalIcon = $scope.newInternalIcon;
                        this.type = 'internal';
                        this.title = $scope.newCaption;
                    }();
                    $scope.model.value.push(newIntLink);
                }
                $scope.newCaption = '';
                $scope.newLink = 'http://';
                $scope.newNewWindow = false;
                $scope.newInternal = null;
                $scope.newInternalName = '';
                $scope.newInternalIcon = null;
            }
            $event.preventDefault();
        };
        $scope.switch = function ($event) {
            $scope.addExternal = !$scope.addExternal;
            $event.preventDefault();
        };
        $scope.switchLinkType = function ($event, link) {
            link.isInternal = !link.isInternal;
            link.type = link.isInternal ? 'internal' : 'external';
            if (!link.isInternal)
                link.link = $scope.newLink;
            $event.preventDefault();
        };
        $scope.move = function (index, direction) {
            var temp = $scope.model.value[index];
            $scope.model.value[index] = $scope.model.value[index + direction];
            $scope.model.value[index + direction] = temp;
        };
        //helper for determining if a user can add items
        $scope.canAdd = function () {
            return $scope.model.config.max <= 0 || $scope.model.config.max > countVisible();
        };
        //helper that returns if an item can be sorted
        $scope.canSort = function () {
            return countVisible() > 1;
        };
        $scope.sortableOptions = {
            axis: 'y',
            handle: '.handle',
            cursor: 'move',
            cancel: '.no-drag',
            containment: 'parent',
            placeholder: 'sortable-placeholder',
            forcePlaceholderSize: true,
            helper: function helper(e, ui) {
                // When sorting table rows, the cells collapse. This helper fixes that: https://www.foliotek.com/devblog/make-table-rows-sortable-using-jquery-ui-sortable/
                ui.children().each(function () {
                    $(this).width($(this).width());
                });
                return ui;
            },
            items: '> tr:not(.unsortable)',
            tolerance: 'pointer',
            update: function update(e, ui) {
                // Get the new and old index for the moved element (using the URL as the identifier)
                var newIndex = ui.item.index();
                var movedLinkUrl = ui.item.attr('data-link');
                var originalIndex = getElementIndexByUrl(movedLinkUrl);
                // Move the element in the model
                var movedElement = $scope.model.value[originalIndex];
                $scope.model.value.splice(originalIndex, 1);
                $scope.model.value.splice(newIndex, 0, movedElement);
            },
            start: function start(e, ui) {
                //ui.placeholder.html("<td colspan='5'></td>");
                // Build a placeholder cell that spans all the cells in the row: https://stackoverflow.com/questions/25845310/jquery-ui-sortable-and-table-cell-size
                var cellCount = 0;
                $('td, th', ui.helper).each(function () {
                    // For each td or th try and get it's colspan attribute, and add that or 1 to the total
                    var colspan = 1;
                    var colspanAttr = $(this).attr('colspan');
                    if (colspanAttr > 1) {
                        colspan = colspanAttr;
                    }
                    cellCount += colspan;
                });
                // Add the placeholder UI - note that this is the item's content, so td rather than tr - and set height of tr
                ui.placeholder.html('<td colspan="' + cellCount + '"></td>').height(ui.item.height());
            }
        };
        //helper to count what is visible
        function countVisible() {
            return $scope.model.value.length;
        }
        function isNumeric(n) {
            return !isNaN(parseFloat(n)) && isFinite(n);
        }
        function getElementIndexByUrl(url) {
            for (var i = 0; i < $scope.model.value.length; i++) {
                if ($scope.model.value[i].link == url) {
                    return i;
                }
            }
            return -1;
        }
        function select(data) {
            if ($scope.currentEditLink != null) {
                $scope.currentEditLink.internal = $scope.model.config.idType === 'udi' ? data.udi : data.id;
                $scope.currentEditLink.internalName = data.name;
                $scope.currentEditLink.internalIcon = iconHelper.convertFromLegacyIcon(data.icon);
                $scope.currentEditLink.link = $scope.model.config.idType === 'udi' ? data.udi : data.id;
            } else {
                $scope.newInternal = $scope.model.config.idType === 'udi' ? data.udi : data.id;
                $scope.newInternalName = data.name;
                $scope.newInternalIcon = iconHelper.convertFromLegacyIcon(data.icon);
            }
        }
    });
    'use strict';
    (function () {
        'use strict';
        function CodeEditorController($scope, localizationService) {
            var vm = this;
            vm.submit = submit;
            vm.close = close;
            vm.aceOption = {};
            vm.aceOption = {
                mode: 'razor',
                theme: 'chrome',
                showPrintMargin: false,
                advanced: {
                    fontSize: '14px',
                    enableSnippets: false,
                    //The Razor mode snippets are awful (Need a way to override these)
                    enableBasicAutocompletion: true,
                    enableLiveAutocompletion: false
                },
                onLoad: function onLoad(aceEditor) {
                    vm.aceEditor = aceEditor;
                }
            };
            vm.template = {};
            vm.template.content = $scope.model.content;
            //////////
            function onInit() {
                // set default title
                if (!$scope.model.title) {
                    // TODO localize
                    $scope.model.title = 'Edit source code';
                }
            }
            function submit(model) {
                // refresh the model
                model.content = vm.aceEditor.getValue();
                if ($scope.model.submit) {
                    $scope.model.submit(model);
                }
            }
            function close() {
                if ($scope.model.close) {
                    $scope.model.close();
                }
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.PropertyEditors.RTECodeEditorController', CodeEditorController);
    }());
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.RTEController', function ($scope, $q, assetsService, $timeout, tinyMceService, angularHelper, editorService, macroService, editorState) {
        //TODO: A lot of the code below should be shared between the grid rte and the normal rte
        $scope.isLoading = true;
        //To id the html textarea we need to use the datetime ticks because we can have multiple rte's per a single property alias
        // because now we have to support having 2x (maybe more at some stage) content editors being displayed at once. This is because
        // we have this mini content editor panel that can be launched with MNTP.
        var d = new Date();
        var n = d.getTime();
        $scope.textAreaHtmlId = $scope.model.alias + '_' + n + '_rte';
        var editorConfig = $scope.model.config.editor;
        if (!editorConfig || angular.isString(editorConfig)) {
            editorConfig = tinyMceService.defaultPrevalues();
        }
        var promises = [];
        if (!editorConfig.maxImageSize && editorConfig.maxImageSize != 0) {
            editorConfig.maxImageSize = tinyMceService.defaultPrevalues().maxImageSize;
        }
        //queue file loading
        if (typeof tinymce === 'undefined') {
            // Don't reload tinymce if already loaded
            promises.push(assetsService.loadJs('lib/tinymce/tinymce.min.js', $scope));
        }
        //stores a reference to the editor
        var tinyMceEditor = null;
        promises.push(tinyMceService.getTinyMceEditorConfig({
            htmlId: $scope.textAreaHtmlId,
            stylesheets: editorConfig.stylesheets,
            toolbar: editorConfig.toolbar,
            mode: editorConfig.mode
        }));
        //wait for queue to end
        $q.all(promises).then(function (result) {
            var standardConfig = result[promises.length - 1];
            //create a baseline Config to exten upon
            var baseLineConfigObj = { maxImageSize: editorConfig.maxImageSize };
            angular.extend(baseLineConfigObj, standardConfig);
            baseLineConfigObj.setup = function (editor) {
                //set the reference
                tinyMceEditor = editor;
                //initialize the standard editor functionality for Umbraco
                tinyMceService.initializeEditor({
                    editor: editor,
                    value: $scope.model.value,
                    currentForm: angularHelper.getCurrentForm($scope)
                });
            };
            /** Loads in the editor */
            function loadTinyMce() {
                //we need to add a timeout here, to force a redraw so TinyMCE can find
                //the elements needed
                $timeout(function () {
                    tinymce.DOM.events.domLoaded = true;
                    tinymce.init(baseLineConfigObj);
                    $scope.isLoading = false;
                }, 200);
            }
            loadTinyMce();
            //listen for formSubmitting event (the result is callback used to remove the event subscription)
            var unsubscribe = $scope.$on('formSubmitting', function () {
                if (tinyMceEditor !== undefined && tinyMceEditor != null && !$scope.isLoading) {
                    $scope.model.value = tinyMceEditor.getContent();
                }
            });
            //when the element is disposed we need to unsubscribe!
            // NOTE: this is very important otherwise if this is part of a modal, the listener still exists because the dom
            // element might still be there even after the modal has been hidden.
            $scope.$on('$destroy', function () {
                unsubscribe();
                if (tinyMceEditor !== undefined && tinyMceEditor != null) {
                    tinyMceEditor.destroy();
                }
            });
        });
    });
    'use strict';
    angular.module('umbraco').controller('Umbraco.PrevalueEditors.RteController', function ($scope, $timeout, $log, tinyMceService, stylesheetResource, assetsService) {
        var cfg = tinyMceService.defaultPrevalues();
        if ($scope.model.value) {
            if (angular.isString($scope.model.value)) {
                $scope.model.value = cfg;
            }
        } else {
            $scope.model.value = cfg;
        }
        if (!$scope.model.value.stylesheets) {
            $scope.model.value.stylesheets = [];
        }
        if (!$scope.model.value.toolbar) {
            $scope.model.value.toolbar = [];
        }
        if (!$scope.model.value.maxImageSize && $scope.model.value.maxImageSize != 0) {
            $scope.model.value.maxImageSize = cfg.maxImageSize;
        }
        if (!$scope.model.value.mode) {
            $scope.model.value.mode = 'classic';
        }
        tinyMceService.configuration().then(function (config) {
            $scope.tinyMceConfig = config;
            // extend commands with properties for font-icon and if it is a custom command
            $scope.tinyMceConfig.commands = _.map($scope.tinyMceConfig.commands, function (obj) {
                var icon = getFontIcon(obj.alias);
                return angular.extend(obj, {
                    fontIcon: icon.name,
                    isCustom: icon.isCustom
                });
            });
        });
        stylesheetResource.getAll().then(function (stylesheets) {
            $scope.stylesheets = stylesheets;
        });
        $scope.selected = function (cmd, alias, lookup) {
            if (lookup && angular.isArray(lookup)) {
                cmd.selected = lookup.indexOf(alias) >= 0;
                return cmd.selected;
            }
            return false;
        };
        $scope.selectCommand = function (command) {
            var index = $scope.model.value.toolbar.indexOf(command.alias);
            if (command.selected && index === -1) {
                $scope.model.value.toolbar.push(command.alias);
            } else if (index >= 0) {
                $scope.model.value.toolbar.splice(index, 1);
            }
        };
        $scope.selectStylesheet = function (css) {
            var index = $scope.model.value.stylesheets.indexOf(css.name);
            if (css.selected && index === -1) {
                $scope.model.value.stylesheets.push(css.name);
            } else if (index >= 0) {
                $scope.model.value.stylesheets.splice(index, 1);
            }
        };
        // map properties for specific commands
        function getFontIcon(alias) {
            var icon = {
                name: alias,
                isCustom: false
            };
            switch (alias) {
            case 'ace':
                icon.name = 'code';
                icon.isCustom = false;
                break;
            case 'styleselect':
            case 'fontsizeselect':
                icon.name = 'icon-list';
                icon.isCustom = true;
                break;
            case 'umbembeddialog':
                icon.name = 'icon-tv';
                icon.isCustom = true;
                break;
            case 'umbmediapicker':
                icon.name = 'icon-picture';
                icon.isCustom = true;
                break;
            case 'umbmacro':
                icon.name = 'icon-settings-alt';
                icon.isCustom = true;
                break;
            case 'umbmacro':
                icon.name = 'icon-settings-alt';
                icon.isCustom = true;
                break;
            default:
                icon.name = alias;
                icon.isCustom = false;
            }
            return icon;
        }
        var unsubscribe = $scope.$on('formSubmitting', function (ev, args) {
            var commands = _.where($scope.tinyMceConfig.commands, { selected: true });
            $scope.model.value.toolbar = _.pluck(commands, 'alias');
        });
        // when the scope is destroyed we need to unsubscribe
        $scope.$on('$destroy', function () {
            unsubscribe();
        });
        // load TinyMCE skin which contains css for font-icons
        assetsService.loadCss('lib/tinymce/skins/umbraco/skin.min.css', $scope);
    });
    'use strict';
    function sliderController($scope, angularHelper) {
        var sliderRef = null;
        /** configure some defaults on init */
        function configureDefaults() {
            $scope.model.config.enableRange = $scope.model.config.enableRange ? Object.toBoolean($scope.model.config.enableRange) : false;
            $scope.model.config.initVal1 = $scope.model.config.initVal1 ? parseFloat($scope.model.config.initVal1) : 0;
            $scope.model.config.initVal2 = $scope.model.config.initVal2 ? parseFloat($scope.model.config.initVal2) : 0;
            $scope.model.config.minVal = $scope.model.config.minVal ? parseFloat($scope.model.config.minVal) : 0;
            $scope.model.config.maxVal = $scope.model.config.maxVal ? parseFloat($scope.model.config.maxVal) : 100;
            $scope.model.config.step = $scope.model.config.step ? parseFloat($scope.model.config.step) : 1;
        }
        function setModelValue(values) {
            $scope.model.value = values ? values.toString() : null;
            angularHelper.getCurrentForm($scope).$setDirty();
        }
        $scope.setup = function (slider) {
            sliderRef = slider;
        };
        $scope.change = function (values) {
            setModelValue(values);
        };
        function init() {
            // convert to array
            $scope.sliderValue = $scope.model.value ? $scope.model.value.split(',') : null;
            configureDefaults();
            // format config to fit slider plugin
            var start = $scope.model.config.enableRange ? [
                $scope.model.config.initVal1,
                $scope.model.config.initVal2
            ] : [$scope.model.config.initVal1];
            var step = $scope.model.config.step;
            var tooltips = $scope.model.config.enableRange ? [
                true,
                true
            ] : [true];
            var min = $scope.model.config.minVal ? [$scope.model.config.minVal] : [$scope.model.config.minVal];
            var max = $scope.model.config.maxVal ? [$scope.model.config.maxVal] : [$scope.model.config.maxVal];
            // setup default
            $scope.sliderOptions = {
                'start': start,
                'step': step,
                'tooltips': tooltips,
                'format': {
                    to: function to(value) {
                        return Math.round(value);
                    },
                    from: function from(value) {
                        return Math.round(value);
                    }
                },
                'range': {
                    'min': min,
                    'max': max
                },
                'pips': {
                    mode: 'steps',
                    density: 100,
                    filter: filterPips
                }
            };
            function filterPips(value) {
                // show a pip for min and maximum value
                return value === $scope.model.config.minVal || value === $scope.model.config.maxVal ? 1 : -1;
            }
        }
        $scope.$watch('model.value', function (newValue, oldValue) {
            if (newValue && newValue !== oldValue) {
                $scope.sliderValue = newValue.split(',');
                sliderRef.noUiSlider.set($scope.sliderValue);
            }
        });
        init();
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.SliderController', sliderController);
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.TagsController', function ($scope) {
        $scope.valueChanged = function (value) {
            $scope.model.value = value;
        };
    });
    'use strict';
    function textAreaController($scope) {
        // macro parameter editor doesn't contains a config object,
        // so we create a new one to hold any properties 
        if (!$scope.model.config) {
            $scope.model.config = {};
        }
        if (!$scope.model.config.maxChars) {
            $scope.model.config.maxChars = false;
        }
        $scope.model.maxlength = false;
        if ($scope.model.config && $scope.model.config.maxChars) {
            $scope.model.maxlength = true;
            if ($scope.model.value == undefined) {
                $scope.model.count = $scope.model.config.maxChars * 1;
            } else {
                $scope.model.count = $scope.model.config.maxChars * 1 - $scope.model.value.length;
            }
        }
        $scope.model.change = function () {
            if ($scope.model.config && $scope.model.config.maxChars) {
                if ($scope.model.value == undefined) {
                    $scope.model.count = $scope.model.config.maxChars * 1;
                } else {
                    $scope.model.count = $scope.model.config.maxChars * 1 - $scope.model.value.length;
                }
                if ($scope.model.count < 0) {
                    $scope.model.value = $scope.model.value.substring(0, $scope.model.config.maxChars * 1);
                    $scope.model.count = 0;
                }
            }
        };
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.textAreaController', textAreaController);
    'use strict';
    function textboxController($scope) {
        // macro parameter editor doesn't contains a config object,
        // so we create a new one to hold any properties
        if (!$scope.model.config) {
            $scope.model.config = {};
        }
        $scope.model.maxlength = false;
        if ($scope.model.config && $scope.model.config.maxChars) {
            $scope.model.maxlength = true;
        }
        if (!$scope.model.config.maxChars) {
            // 500 is the maximum number that can be stored
            // in the database, so set it to the max, even
            // if no max is specified in the config
            $scope.model.config.maxChars = 500;
        }
        if ($scope.model.maxlength) {
            if ($scope.model.value === undefined) {
                $scope.model.count = $scope.model.config.maxChars * 1;
            } else {
                $scope.model.count = $scope.model.config.maxChars * 1 - $scope.model.value.length;
            }
        }
        $scope.model.change = function () {
            if ($scope.model.config && $scope.model.config.maxChars) {
                if ($scope.model.value === undefined) {
                    $scope.model.count = $scope.model.config.maxChars * 1;
                } else {
                    $scope.model.count = $scope.model.config.maxChars * 1 - $scope.model.value.length;
                }
                if ($scope.model.count < 0) {
                    $scope.model.value = $scope.model.value.substring(0, $scope.model.config.maxChars * 1);
                    $scope.model.count = 0;
                }
            }
        };
    }
    angular.module('umbraco').controller('Umbraco.PropertyEditors.textboxController', textboxController);
    'use strict';
    angular.module('umbraco').controller('Umbraco.PropertyEditors.UrlListController', function ($rootScope, $scope, $filter) {
        function formatDisplayValue() {
            if (angular.isArray($scope.model.value)) {
                //it's the json value
                $scope.renderModel = _.map($scope.model.value, function (item) {
                    return {
                        url: item.url,
                        linkText: item.linkText,
                        urlTarget: item.target ? item.target : '_blank',
                        icon: item.icon ? item.icon : 'icon-out'
                    };
                });
            } else {
                //it's the default csv value
                $scope.renderModel = _.map($scope.model.value.split(','), function (item) {
                    return {
                        url: item,
                        linkText: '',
                        urlTarget: $scope.config && $scope.config.target ? $scope.config.target : '_blank',
                        icon: $scope.config && $scope.config.icon ? $scope.config.icon : 'icon-out'
                    };
                });
            }
        }
        $scope.getUrl = function (valueUrl) {
            if (valueUrl.indexOf('/') >= 0) {
                return valueUrl;
            }
            return '#';
        };
        formatDisplayValue();
        //here we declare a special method which will be called whenever the value has changed from the server
        //this is instead of doing a watch on the model.value = faster
        $scope.model.onValueChanged = function (newVal, oldVal) {
            //update the display val again
            formatDisplayValue();
        };
    });
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.RelationTypes.CreateController
 * @function
 *
 * @description
 * The controller for creating relation types.
 */
    function RelationTypeCreateController($scope, $location, relationTypeResource, navigationService, formHelper, appState, notificationsService) {
        var vm = this;
        vm.relationType = {};
        vm.objectTypes = {};
        vm.createRelationType = createRelationType;
        init();
        function init() {
            relationTypeResource.getRelationObjectTypes().then(function (data) {
                vm.objectTypes = data;
            }, function (err) {
                notificationsService.error('Could not load form.');
            });
        }
        function createRelationType() {
            if (formHelper.submitForm({
                    scope: $scope,
                    formCtrl: this.createRelationTypeForm,
                    statusMessage: 'Creating relation type...'
                })) {
                var node = $scope.currentNode;
                relationTypeResource.create(vm.relationType).then(function (data) {
                    navigationService.hideMenu();
                    // Set the new item as active in the tree
                    var currentPath = node.path ? node.path : '-1';
                    navigationService.syncTree({
                        tree: 'relationTypes',
                        path: currentPath + ',' + data,
                        forceReload: true,
                        activate: true
                    });
                    formHelper.resetForm({ scope: $scope });
                    var currentSection = appState.getSectionState('currentSection');
                    $location.path('/' + currentSection + '/relationTypes/edit/' + data);
                }, function (err) {
                    if (err.data && err.data.message) {
                        notificationsService.error(err.data.message);
                        navigationService.hideMenu();
                    }
                });
            }
        }
    }
    angular.module('umbraco').controller('Umbraco.Editors.RelationTypes.CreateController', RelationTypeCreateController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.RelationTypes.DeleteController
 * @function
 *
 * @description
 * The controller for deleting relation types.
 */
    function RelationTypeDeleteController($scope, $location, relationTypeResource, treeService, navigationService, appState) {
        var vm = this;
        vm.cancel = cancel;
        vm.performDelete = performDelete;
        function cancel() {
            navigationService.hideDialog();
        }
        function performDelete() {
            // stop from firing again on double-click
            if ($scope.busy) {
                return false;
            }
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            $scope.busy = true;
            relationTypeResource.deleteById($scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
                var currentSection = appState.getSectionState('currentSection');
                $location.path('/' + currentSection + '/');
            });
        }
    }
    angular.module('umbraco').controller('Umbraco.Editors.RelationTypes.DeleteController', RelationTypeDeleteController);
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.RelationTypes.EditController
 * @function
 *
 * @description
 * The controller for editing relation types.
 */
    function RelationTypeEditController($scope, $routeParams, relationTypeResource, editorState, navigationService, dateHelper, userService, entityResource, formHelper, contentEditingHelper, localizationService) {
        var vm = this;
        vm.page = {};
        vm.page.loading = false;
        vm.page.saveButtonState = 'init';
        vm.page.menu = {};
        vm.save = saveRelationType;
        init();
        function init() {
            vm.page.loading = true;
            localizationService.localizeMany([
                'relationType_tabRelationType',
                'relationType_tabRelations'
            ]).then(function (data) {
                vm.page.navigation = [
                    {
                        'name': data[0],
                        'alias': 'relationType',
                        'icon': 'icon-info',
                        'view': 'views/relationTypes/views/relationType.html',
                        'active': true
                    },
                    {
                        'name': data[1],
                        'alias': 'relations',
                        'icon': 'icon-trafic',
                        'view': 'views/relationTypes/views/relations.html'
                    }
                ];
            });
            relationTypeResource.getById($routeParams.id).then(function (data) {
                bindRelationType(data);
                vm.page.loading = false;
            });
        }
        function bindRelationType(relationType) {
            formatDates(relationType.relations);
            getRelationNames(relationType);
            vm.relationType = relationType;
            editorState.set(vm.relationType);
            navigationService.syncTree({
                tree: 'relationTypes',
                path: relationType.path,
                forceReload: true
            }).then(function (syncArgs) {
                vm.page.menu.currentNode = syncArgs.node;
            });
        }
        function formatDates(relations) {
            if (relations) {
                userService.getCurrentUser().then(function (currentUser) {
                    angular.forEach(relations, function (relation) {
                        relation.timestampFormatted = dateHelper.getLocalDate(relation.createDate, currentUser.locale, 'LLL');
                    });
                });
            }
        }
        function getRelationNames(relationType) {
            if (relationType.relations) {
                angular.forEach(relationType.relations, function (relation) {
                    entityResource.getById(relation.parentId, relationType.parentObjectTypeName).then(function (entity) {
                        relation.parentName = entity.name;
                    });
                    entityResource.getById(relation.childId, relationType.childObjectTypeName).then(function (entity) {
                        relation.childName = entity.name;
                    });
                });
            }
        }
        function saveRelationType() {
            vm.page.saveButtonState = 'busy';
            if (formHelper.submitForm({
                    scope: $scope,
                    statusMessage: 'Saving...'
                })) {
                relationTypeResource.save(vm.relationType).then(function (data) {
                    formHelper.resetForm({
                        scope: $scope,
                        notifications: data.notifications
                    });
                    bindRelationType(data);
                    vm.page.saveButtonState = 'success';
                }, function (error) {
                    contentEditingHelper.handleSaveError({
                        redirectOnFailure: false,
                        err: error
                    });
                    notificationsService.error(error.data.message);
                    vm.page.saveButtonState = 'error';
                });
            }
        }
    }
    angular.module('umbraco').controller('Umbraco.Editors.RelationTypes.EditController', RelationTypeEditController);
    'use strict';
    (function () {
        'use strict';
        function ScriptsCreateController($scope, $location, navigationService, formHelper, codefileResource, localizationService, appState) {
            var vm = this;
            var node = $scope.currentNode;
            vm.creatingFolder = false;
            vm.folderName = '';
            vm.createFolderError = '';
            vm.fileExtension = '';
            vm.createFile = createFile;
            vm.showCreateFolder = showCreateFolder;
            vm.createFolder = createFolder;
            vm.close = close;
            function createFile() {
                $location.path('/settings/scripts/edit/' + node.id).search('create', 'true');
                navigationService.hideMenu();
            }
            function showCreateFolder() {
                vm.creatingFolder = true;
            }
            function createFolder(form) {
                if (formHelper.submitForm({
                        scope: $scope,
                        formCtrl: form
                    })) {
                    codefileResource.createContainer('scripts', node.id, vm.folderName).then(function (saved) {
                        navigationService.hideMenu();
                        navigationService.syncTree({
                            tree: 'scripts',
                            path: saved.path,
                            forceReload: true,
                            activate: true
                        });
                        formHelper.resetForm({ scope: $scope });
                        var section = appState.getSectionState('currentSection');
                    }, function (err) {
                        vm.createFolderError = err;
                    });
                }
            }
            function close() {
                var showMenu = true;
                navigationService.hideDialog(showMenu);
            }
        }
        angular.module('umbraco').controller('Umbraco.Editors.Scripts.CreateController', ScriptsCreateController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Scripts.DeleteController
 * @function
 *
 * @description
 * The controller for deleting scripts
 */
    function ScriptsDeleteController($scope, codefileResource, treeService, navigationService) {
        $scope.performDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            codefileResource.deleteByPath('scripts', $scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                //TODO: Need to sync tree, etc...
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.Scripts.DeleteController', ScriptsDeleteController);
    'use strict';
    (function () {
        'use strict';
        function ScriptsEditController($scope, $routeParams, $timeout, appState, editorState, navigationService, assetsService, codefileResource, contentEditingHelper, notificationsService, localizationService, templateHelper, angularHelper) {
            var vm = this;
            var currentPosition = null;
            vm.page = {};
            vm.page.loading = true;
            vm.page.menu = {};
            vm.page.menu.currentSection = appState.getSectionState('currentSection');
            vm.page.menu.currentNode = null;
            vm.page.saveButtonState = 'init';
            //Used to toggle the keyboard shortcut modal
            //From a custom keybinding in ace editor - that conflicts with our own to show the dialog
            vm.showKeyboardShortcut = false;
            //Keyboard shortcuts for help dialog
            vm.page.keyboardShortcutsOverview = [];
            templateHelper.getGeneralShortcuts().then(function (shortcuts) {
                vm.page.keyboardShortcutsOverview.push(shortcuts);
            });
            templateHelper.getEditorShortcuts().then(function (shortcuts) {
                vm.page.keyboardShortcutsOverview.push(shortcuts);
            });
            vm.script = {};
            // bind functions to view model
            vm.save = save;
            /* Function bound to view model */
            function save() {
                vm.page.saveButtonState = 'busy';
                vm.script.content = vm.editor.getValue();
                contentEditingHelper.contentEditorPerformSave({
                    saveMethod: codefileResource.save,
                    scope: $scope,
                    content: vm.script,
                    // We do not redirect on failure for scripts - this is because it is not possible to actually save the script
                    // when server side validation fails - as opposed to content where we are capable of saving the content
                    // item if server side validation fails
                    redirectOnFailure: false,
                    rebindCallback: function rebindCallback(orignal, saved) {
                    }
                }).then(function (saved) {
                    localizationService.localizeMany([
                        'speechBubbles_fileSavedHeader',
                        'speechBubbles_fileSavedText'
                    ]).then(function (data) {
                        var header = data[0];
                        var message = data[1];
                        notificationsService.success(header, message);
                    });
                    //check if the name changed, if so we need to redirect
                    if (vm.script.id !== saved.id) {
                        contentEditingHelper.redirectToRenamedContent(saved.id);
                    } else {
                        vm.page.saveButtonState = 'success';
                        vm.script = saved;
                        //sync state
                        editorState.set(vm.script);
                        // sync tree
                        navigationService.syncTree({
                            tree: 'scripts',
                            path: vm.script.path,
                            forceReload: true
                        }).then(function (syncArgs) {
                            vm.page.menu.currentNode = syncArgs.node;
                        });
                    }
                }, function (err) {
                    vm.page.saveButtonState = 'error';
                    localizationService.localizeMany([
                        'speechBubbles_validationFailedHeader',
                        'speechBubbles_validationFailedMessage'
                    ]).then(function (data) {
                        var header = data[0];
                        var message = data[1];
                        notificationsService.error(header, message);
                    });
                });
            }
            /* Local functions */
            function init() {
                //we need to load this somewhere, for now its here.
                assetsService.loadCss('lib/ace-razor-mode/theme/razor_chrome.css', $scope);
                if ($routeParams.create) {
                    codefileResource.getScaffold('scripts', $routeParams.id).then(function (script) {
                        ready(script, false);
                    });
                } else {
                    codefileResource.getByPath('scripts', $routeParams.id).then(function (script) {
                        ready(script, true);
                    });
                }
            }
            function ready(script, syncTree) {
                vm.page.loading = false;
                vm.script = script;
                //sync state
                editorState.set(vm.script);
                if (syncTree) {
                    navigationService.syncTree({
                        tree: 'scripts',
                        path: vm.script.path,
                        forceReload: true
                    }).then(function (syncArgs) {
                        vm.page.menu.currentNode = syncArgs.node;
                    });
                }
                vm.aceOption = {
                    mode: 'javascript',
                    theme: 'chrome',
                    showPrintMargin: false,
                    advanced: {
                        fontSize: '14px',
                        enableSnippets: true,
                        enableBasicAutocompletion: true,
                        enableLiveAutocompletion: false
                    },
                    onLoad: function onLoad(_editor) {
                        vm.editor = _editor;
                        //Update the auto-complete method to use ctrl+alt+space
                        _editor.commands.bindKey('ctrl-alt-space', 'startAutocomplete');
                        //Unassigns the keybinding (That was previously auto-complete)
                        //As conflicts with our own tree search shortcut
                        _editor.commands.bindKey('ctrl-space', null);
                        //TODO: Move all these keybinding config out into some helper/service
                        _editor.commands.addCommands([//Disable (alt+shift+K)
                            //Conflicts with our own show shortcuts dialog - this overrides it
                            {
                                name: 'unSelectOrFindPrevious',
                                bindKey: 'Alt-Shift-K',
                                exec: function exec() {
                                    //Toggle the show keyboard shortcuts overlay
                                    $scope.$apply(function () {
                                        vm.showKeyboardShortcut = !vm.showKeyboardShortcut;
                                    });
                                },
                                readOnly: true
                            }]);
                        // initial cursor placement
                        // Keep cursor in name field if we are create a new script
                        // else set the cursor at the bottom of the code editor
                        if (!$routeParams.create) {
                            $timeout(function () {
                                vm.editor.navigateFileEnd();
                                vm.editor.focus();
                            });
                        }
                        vm.editor.on('change', changeAceEditor);
                    }
                };
                function changeAceEditor() {
                    setFormState('dirty');
                }
                function setFormState(state) {
                    // get the current form
                    var currentForm = angularHelper.getCurrentForm($scope);
                    // set state
                    if (state === 'dirty') {
                        currentForm.$setDirty();
                    } else if (state === 'pristine') {
                        currentForm.$setPristine();
                    }
                }
            }
            init();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Scripts.EditController', ScriptsEditController);
    }());
    'use strict';
    (function () {
        'use strict';
        function StyleSheetsCreateController($scope, $location, navigationService) {
            var vm = this;
            var node = $scope.currentNode;
            vm.createFile = createFile;
            vm.createRichtextStyle = createRichtextStyle;
            vm.close = close;
            function createFile() {
                $location.path('/settings/stylesheets/edit/' + node.id).search('create', 'true');
                navigationService.hideMenu();
            }
            function createRichtextStyle() {
                $location.path('/settings/stylesheets/edit/' + node.id).search('create', 'true').search('rtestyle', 'true');
                navigationService.hideMenu();
            }
            function close() {
                var showMenu = true;
                navigationService.hideDialog(showMenu);
            }
        }
        angular.module('umbraco').controller('Umbraco.Editors.StyleSheets.CreateController', StyleSheetsCreateController);
    }());
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.StyleSheets.DeleteController
 * @function
 *
 * @description
 * The controller for deleting stylesheets
 */
    function StyleSheetsDeleteController($scope, codefileResource, treeService, navigationService) {
        $scope.performDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            codefileResource.deleteByPath('stylesheets', $scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.StyleSheets.DeleteController', StyleSheetsDeleteController);
    'use strict';
    (function () {
        'use strict';
        function StyleSheetsEditController($scope, $routeParams, $timeout, $http, appState, editorState, navigationService, assetsService, codefileResource, contentEditingHelper, notificationsService, localizationService, templateHelper, angularHelper, umbRequestHelper) {
            var vm = this;
            vm.page = {};
            vm.page.loading = true;
            vm.page.menu = {};
            vm.page.menu.currentSection = appState.getSectionState('currentSection');
            vm.page.menu.currentNode = null;
            vm.page.saveButtonState = 'init';
            //Used to toggle the keyboard shortcut modal
            //From a custom keybinding in ace editor - that conflicts with our own to show the dialog
            vm.showKeyboardShortcut = false;
            //Keyboard shortcuts for help dialog
            vm.page.keyboardShortcutsOverview = [];
            templateHelper.getGeneralShortcuts().then(function (shortcuts) {
                vm.page.keyboardShortcutsOverview.push(shortcuts);
            });
            templateHelper.getEditorShortcuts().then(function (shortcuts) {
                vm.page.keyboardShortcutsOverview.push(shortcuts);
            });
            vm.stylesheet = {
                content: '',
                rules: []
            };
            // bind functions to view model
            vm.save = interpolateAndSave;
            /* Function bound to view model */
            function interpolateAndSave() {
                vm.page.saveButtonState = 'busy';
                var activeApp = _.find(vm.page.navigation, function (item) {
                    return item.active;
                });
                if (activeApp.alias === 'rules') {
                    // we're on the rules tab: interpolate the rules into the editor value and save the output as stylesheet content
                    interpolateRules().then(function (content) {
                        vm.stylesheet.content = content;
                        save(activeApp);
                    }, function (err) {
                    });
                } else {
                    // we're on the code tab: just save the editor value as stylesheet content
                    vm.stylesheet.content = vm.editor.getValue();
                    save(activeApp);
                }
            }
            /* Local functions */
            function save(activeApp) {
                contentEditingHelper.contentEditorPerformSave({
                    saveMethod: codefileResource.save,
                    scope: $scope,
                    content: vm.stylesheet,
                    // We do not redirect on failure for style sheets - this is because it is not possible to actually save the style sheet
                    // when server side validation fails - as opposed to content where we are capable of saving the content
                    // item if server side validation fails
                    redirectOnFailure: false,
                    rebindCallback: function rebindCallback(orignal, saved) {
                    }
                }).then(function (saved) {
                    localizationService.localizeMany([
                        'speechBubbles_fileSavedHeader',
                        'speechBubbles_fileSavedText'
                    ]).then(function (data) {
                        var header = data[0];
                        var message = data[1];
                        notificationsService.success(header, message);
                    });
                    //check if the name changed, if so we need to redirect
                    if (vm.stylesheet.id !== saved.id) {
                        contentEditingHelper.redirectToRenamedContent(saved.id);
                    } else {
                        vm.page.saveButtonState = 'success';
                        vm.stylesheet = saved;
                        //sync state
                        editorState.set(vm.stylesheet);
                        // sync tree
                        navigationService.syncTree({
                            tree: 'stylesheets',
                            path: vm.stylesheet.path,
                            forceReload: true
                        }).then(function (syncArgs) {
                            vm.page.menu.currentNode = syncArgs.node;
                        });
                        if (activeApp.alias === 'rules') {
                            $scope.selectApp(activeApp);
                        }
                    }
                }, function (err) {
                    vm.page.saveButtonState = 'error';
                    localizationService.localizeMany([
                        'speechBubbles_validationFailedHeader',
                        'speechBubbles_validationFailedMessage'
                    ]).then(function (data) {
                        var header = data[0];
                        var message = data[1];
                        notificationsService.error(header, message);
                    });
                });
            }
            function init() {
                //we need to load this somewhere, for now its here.
                assetsService.loadCss('lib/ace-razor-mode/theme/razor_chrome.css', $scope);
                if ($routeParams.create) {
                    codefileResource.getScaffold('stylesheets', $routeParams.id).then(function (stylesheet) {
                        var mode = $routeParams.rtestyle ? 'RTE' : null;
                        ready(stylesheet, false);
                        generateNavigation(mode);
                    });
                } else {
                    codefileResource.getByPath('stylesheets', $routeParams.id).then(function (stylesheet) {
                        ready(stylesheet, true);
                        extractRules().then(function (rules) {
                            vm.stylesheet.rules = rules;
                            var mode = rules && rules.length > 0 ? 'RTE' : null;
                            generateNavigation(mode);
                        });
                    });
                }
            }
            function generateNavigation(mode) {
                localizationService.localizeMany([
                    'stylesheet_tabRules',
                    'stylesheet_tabCode'
                ]).then(function (data) {
                    vm.page.navigation = [
                        {
                            'name': data[0],
                            'alias': 'rules',
                            'icon': 'icon-font',
                            'view': 'views/stylesheets/views/rules/rules.html'
                        },
                        {
                            'name': data[1],
                            'alias': 'code',
                            'icon': 'icon-brackets',
                            'view': 'views/stylesheets/views/code/code.html'
                        }
                    ];
                    if (mode === 'RTE') {
                        vm.page.navigation[0].active = true;
                    } else {
                        vm.page.navigation[1].active = true;
                    }
                });
            }
            function ready(stylesheet, syncTree) {
                vm.page.loading = false;
                vm.stylesheet = stylesheet;
                vm.setDirty = function () {
                    setFormState('dirty');
                };
                //sync state
                editorState.set(vm.stylesheet);
                if (syncTree) {
                    navigationService.syncTree({
                        tree: 'stylesheets',
                        path: vm.stylesheet.path,
                        forceReload: true
                    }).then(function (syncArgs) {
                        vm.page.menu.currentNode = syncArgs.node;
                    });
                }
                vm.aceOption = {
                    mode: 'css',
                    theme: 'chrome',
                    showPrintMargin: false,
                    advanced: {
                        fontSize: '14px',
                        enableSnippets: true,
                        enableBasicAutocompletion: true,
                        enableLiveAutocompletion: false
                    },
                    onLoad: function onLoad(_editor) {
                        vm.editor = _editor;
                        //Update the auto-complete method to use ctrl+alt+space
                        _editor.commands.bindKey('ctrl-alt-space', 'startAutocomplete');
                        //Unassigns the keybinding (That was previously auto-complete)
                        //As conflicts with our own tree search shortcut
                        _editor.commands.bindKey('ctrl-space', null);
                        //TODO: Move all these keybinding config out into some helper/service
                        _editor.commands.addCommands([//Disable (alt+shift+K)
                            //Conflicts with our own show shortcuts dialog - this overrides it
                            {
                                name: 'unSelectOrFindPrevious',
                                bindKey: 'Alt-Shift-K',
                                exec: function exec() {
                                    //Toggle the show keyboard shortcuts overlay
                                    $scope.$apply(function () {
                                        vm.showKeyboardShortcut = !vm.showKeyboardShortcut;
                                    });
                                },
                                readOnly: true
                            }]);
                        // initial cursor placement
                        // Keep cursor in name field if we are create a new style sheet
                        // else set the cursor at the bottom of the code editor
                        if (!$routeParams.create) {
                            $timeout(function () {
                                vm.editor.navigateFileEnd();
                                vm.editor.focus();
                            });
                        }
                        vm.editor.on('change', changeAceEditor);
                    }
                };
                function changeAceEditor() {
                    setFormState('dirty');
                }
                function setFormState(state) {
                    // get the current form
                    var currentForm = angularHelper.getCurrentForm($scope);
                    // set state
                    if (state === 'dirty') {
                        currentForm.$setDirty();
                    } else if (state === 'pristine') {
                        currentForm.$setPristine();
                    }
                }
            }
            function interpolateRules() {
                return codefileResource.interpolateStylesheetRules(vm.stylesheet.content, vm.stylesheet.rules);
            }
            function extractRules() {
                return codefileResource.extractStylesheetRules(vm.stylesheet.content);
            }
            $scope.selectApp = function (app) {
                vm.page.loading = true;
                // are we going to the code tab?
                if (app.alias === 'code') {
                    // yes - interpolate the rules into the current editor value before displaying the editor
                    interpolateRules().then(function (content) {
                        vm.stylesheet.content = content;
                        vm.page.loading = false;
                    }, function (err) {
                    });
                } else {
                    // no - extract the rules from the current editor value before displaying the rules tab
                    extractRules().then(function (rules) {
                        vm.stylesheet.rules = rules;
                        vm.page.loading = false;
                    }, function (err) {
                    });
                }
            };
            init();
        }
        angular.module('umbraco').controller('Umbraco.Editors.StyleSheets.EditController', StyleSheetsEditController);
    }());
    'use strict';
    (function () {
        'use strict';
        function RichTextRuleController($scope, formHelper) {
            var vm = this;
            vm.submit = submit;
            vm.close = close;
            function submit() {
                if ($scope.model && $scope.model.submit && formHelper.submitForm({ scope: $scope })) {
                    $scope.model.submit($scope.model);
                }
            }
            function close() {
                if ($scope.model && $scope.model.close) {
                    $scope.model.close();
                }
            }
        }
        angular.module('umbraco').controller('Umbraco.Editors.RichTextRuleController', RichTextRuleController);
    }());
    'use strict';
    angular.module('umbraco').controller('Umbraco.Editors.StyleSheets.RulesController', function ($scope, localizationService, editorService) {
        $scope.sortableOptions = {
            axis: 'y',
            containment: 'parent',
            cursor: 'move',
            items: 'div.umb-stylesheet-rules__listitem',
            handle: '.handle',
            tolerance: 'pointer',
            update: function update(e, ui) {
                setDirty();
            }
        };
        $scope.add = function (evt) {
            evt.preventDefault();
            openOverlay({}, $scope.labels.addRule, function (newRule) {
                if (!$scope.model.stylesheet.rules) {
                    $scope.model.stylesheet.rules = [];
                }
                $scope.model.stylesheet.rules.push(newRule);
                setDirty();
            });
        };
        $scope.edit = function (rule, evt) {
            evt.preventDefault();
            openOverlay(rule, $scope.labels.editRule, function (newRule) {
                rule.name = newRule.name;
                rule.selector = newRule.selector;
                rule.styles = newRule.styles;
                setDirty();
            });
        };
        $scope.remove = function (rule, evt) {
            evt.preventDefault();
            $scope.model.stylesheet.rules = _.without($scope.model.stylesheet.rules, rule);
            setDirty();
        };
        function openOverlay(rule, title, onSubmit) {
            var ruleDialog = {
                title: title,
                rule: _.clone(rule),
                view: 'views/stylesheets/infiniteeditors/richtextrule/richtextrule.html',
                size: 'small',
                submit: function submit(model) {
                    onSubmit(model.rule);
                    editorService.close();
                },
                close: function close() {
                    editorService.close();
                }
            };
            editorService.open(ruleDialog);
        }
        function setDirty() {
            $scope.model.setDirty();
        }
        function init() {
            localizationService.localizeMany([
                'stylesheet_overlayTitleAddRule',
                'stylesheet_overlayTitleEditRule'
            ]).then(function (data) {
                $scope.labels = {
                    addRule: data[0],
                    editRule: data[1]
                };
            });
        }
        init();
    });
    'use strict';
    /**
 * @ngdoc controller
 * @name Umbraco.Editors.Templates.DeleteController
 * @function
 *
 * @description
 * The controller for the template delete dialog
 */
    function TemplatesDeleteController($scope, templateResource, treeService, navigationService) {
        $scope.performDelete = function () {
            //mark it for deletion (used in the UI)
            $scope.currentNode.loading = true;
            templateResource.deleteById($scope.currentNode.id).then(function () {
                $scope.currentNode.loading = false;
                //get the root node before we remove it
                var rootNode = treeService.getTreeRoot($scope.currentNode);
                //TODO: Need to sync tree, etc...
                treeService.removeNode($scope.currentNode);
                navigationService.hideMenu();
            });
        };
        $scope.cancel = function () {
            navigationService.hideDialog();
        };
    }
    angular.module('umbraco').controller('Umbraco.Editors.Templates.DeleteController', TemplatesDeleteController);
    'use strict';
    (function () {
        'use strict';
        function TemplatesEditController($scope, $routeParams, $timeout, templateResource, assetsService, notificationsService, editorState, navigationService, appState, macroService, treeService, contentEditingHelper, localizationService, angularHelper, templateHelper, editorService) {
            var vm = this;
            var oldMasterTemplateAlias = null;
            var infiniteMode = $scope.model && $scope.model.infiniteMode;
            var id = infiniteMode ? $scope.model.id : $routeParams.id;
            var create = infiniteMode ? $scope.model.create : $routeParams.create;
            vm.page = {};
            vm.page.loading = true;
            vm.templates = [];
            //menu
            vm.page.menu = {};
            vm.page.menu.currentSection = appState.getSectionState('currentSection');
            vm.page.menu.currentNode = null;
            // insert buttons
            vm.page.insertDefaultButton = {
                labelKey: 'general_insert',
                addEllipsis: 'true',
                handler: function handler() {
                    vm.openInsertOverlay();
                }
            };
            vm.page.insertSubButtons = [
                {
                    labelKey: 'template_insertPageField',
                    addEllipsis: 'true',
                    handler: function handler() {
                        vm.openPageFieldOverlay();
                    }
                },
                {
                    labelKey: 'template_insertPartialView',
                    addEllipsis: 'true',
                    handler: function handler() {
                        vm.openPartialOverlay();
                    }
                },
                {
                    labelKey: 'template_insertDictionaryItem',
                    addEllipsis: 'true',
                    handler: function handler() {
                        vm.openDictionaryItemOverlay();
                    }
                },
                {
                    labelKey: 'template_insertMacro',
                    addEllipsis: 'true',
                    handler: function handler() {
                        vm.openMacroOverlay();
                    }
                }
            ];
            //Used to toggle the keyboard shortcut modal
            //From a custom keybinding in ace editor - that conflicts with our own to show the dialog
            vm.showKeyboardShortcut = false;
            //Keyboard shortcuts for help dialog
            vm.page.keyboardShortcutsOverview = [];
            templateHelper.getGeneralShortcuts().then(function (data) {
                vm.page.keyboardShortcutsOverview.push(data);
            });
            templateHelper.getEditorShortcuts().then(function (data) {
                vm.page.keyboardShortcutsOverview.push(data);
            });
            templateHelper.getTemplateEditorShortcuts().then(function (data) {
                vm.page.keyboardShortcutsOverview.push(data);
            });
            vm.save = function (suppressNotification) {
                vm.page.saveButtonState = 'busy';
                vm.template.content = vm.editor.getValue();
                contentEditingHelper.contentEditorPerformSave({
                    saveMethod: templateResource.save,
                    scope: $scope,
                    content: vm.template,
                    //We do not redirect on failure for templates - this is because it is not possible to actually save the template
                    // type when server side validation fails - as opposed to content where we are capable of saving the content
                    // item if server side validation fails
                    redirectOnFailure: false,
                    rebindCallback: function rebindCallback(orignal, saved) {
                    }
                }).then(function (saved) {
                    if (!suppressNotification) {
                        localizationService.localizeMany([
                            'speechBubbles_templateSavedHeader',
                            'speechBubbles_templateSavedText'
                        ]).then(function (data) {
                            var header = data[0];
                            var message = data[1];
                            notificationsService.success(header, message);
                        });
                    }
                    vm.page.saveButtonState = 'success';
                    vm.template = saved;
                    //sync state
                    if (!infiniteMode) {
                        editorState.set(vm.template);
                    }
                    // sync tree
                    // if master template alias has changed move the node to it's new location
                    if (!infiniteMode && oldMasterTemplateAlias !== vm.template.masterTemplateAlias) {
                        // When creating a new template the id is -1. Make sure We don't remove the root node.
                        if (vm.page.menu.currentNode.id !== '-1') {
                            // move node to new location in tree
                            //first we need to remove the node that we're working on
                            treeService.removeNode(vm.page.menu.currentNode);
                        }
                        // update stored alias to the new one so the node won't move again unless the alias is changed again
                        oldMasterTemplateAlias = vm.template.masterTemplateAlias;
                        navigationService.syncTree({
                            tree: 'templates',
                            path: vm.template.path,
                            forceReload: true,
                            activate: true
                        }).then(function (args) {
                            vm.page.menu.currentNode = args.node;
                        });
                    } else {
                        // normal tree sync
                        if (!infiniteMode) {
                            navigationService.syncTree({
                                tree: 'templates',
                                path: vm.template.path,
                                forceReload: true
                            }).then(function (syncArgs) {
                                vm.page.menu.currentNode = syncArgs.node;
                            });
                        }
                    }
                    // clear $dirty state on form
                    setFormState('pristine');
                    if (infiniteMode) {
                        submit();
                    }
                }, function (err) {
                    if (suppressNotification) {
                        vm.page.saveButtonState = 'error';
                        localizationService.localizeMany([
                            'speechBubbles_validationFailedHeader',
                            'speechBubbles_validationFailedMessage'
                        ]).then(function (data) {
                            var header = data[0];
                            var message = data[1];
                            notificationsService.error(header, message);
                        });
                    }
                });
            };
            vm.init = function () {
                //we need to load this somewhere, for now its here.
                assetsService.loadCss('lib/ace-razor-mode/theme/razor_chrome.css', $scope);
                //load templates - used in the master template picker
                templateResource.getAll().then(function (templates) {
                    vm.templates = templates;
                });
                if (create) {
                    templateResource.getScaffold(id).then(function (template) {
                        vm.ready(template);
                    });
                } else {
                    templateResource.getById(id).then(function (template) {
                        vm.ready(template);
                    });
                }
            };
            vm.ready = function (template) {
                vm.page.loading = false;
                vm.template = template;
                // if this is a new template, bind to the blur event on the name
                if (create) {
                    $timeout(function () {
                        var nameField = angular.element(document.querySelector('[data-element="editor-name-field"]'));
                        if (nameField) {
                            nameField.on('blur', function (event) {
                                if (event.target.value) {
                                    vm.save(true);
                                }
                            });
                        }
                    });
                }
                //sync state
                if (!infiniteMode) {
                    editorState.set(vm.template);
                    navigationService.syncTree({
                        tree: 'templates',
                        path: vm.template.path,
                        forceReload: true
                    }).then(function (syncArgs) {
                        vm.page.menu.currentNode = syncArgs.node;
                    });
                }
                // save state of master template to use for comparison when syncing the tree on save
                oldMasterTemplateAlias = angular.copy(template.masterTemplateAlias);
                // ace configuration
                vm.aceOption = {
                    mode: 'razor',
                    theme: 'chrome',
                    showPrintMargin: false,
                    advanced: {
                        fontSize: '14px',
                        enableSnippets: false,
                        //The Razor mode snippets are awful (Need a way to override these)
                        enableBasicAutocompletion: true,
                        enableLiveAutocompletion: false
                    },
                    onLoad: function onLoad(_editor) {
                        vm.editor = _editor;
                        //Update the auto-complete method to use ctrl+alt+space
                        _editor.commands.bindKey('ctrl-alt-space', 'startAutocomplete');
                        //Unassigns the keybinding (That was previously auto-complete)
                        //As conflicts with our own tree search shortcut
                        _editor.commands.bindKey('ctrl-space', null);
                        // Assign new keybinding
                        _editor.commands.addCommands([
                            //Disable (alt+shift+K)
                            //Conflicts with our own show shortcuts dialog - this overrides it
                            {
                                name: 'unSelectOrFindPrevious',
                                bindKey: 'Alt-Shift-K',
                                exec: function exec() {
                                    //Toggle the show keyboard shortcuts overlay
                                    $scope.$apply(function () {
                                        vm.showKeyboardShortcut = !vm.showKeyboardShortcut;
                                    });
                                },
                                readOnly: true
                            },
                            {
                                name: 'insertUmbracoValue',
                                bindKey: 'Alt-Shift-V',
                                exec: function exec() {
                                    $scope.$apply(function () {
                                        openPageFieldOverlay();
                                    });
                                },
                                readOnly: true
                            },
                            {
                                name: 'insertPartialView',
                                bindKey: 'Alt-Shift-P',
                                exec: function exec() {
                                    $scope.$apply(function () {
                                        openPartialOverlay();
                                    });
                                },
                                readOnly: true
                            },
                            {
                                name: 'insertDictionary',
                                bindKey: 'Alt-Shift-D',
                                exec: function exec() {
                                    $scope.$apply(function () {
                                        openDictionaryItemOverlay();
                                    });
                                },
                                readOnly: true
                            },
                            {
                                name: 'insertUmbracoMacro',
                                bindKey: 'Alt-Shift-M',
                                exec: function exec() {
                                    $scope.$apply(function () {
                                        openMacroOverlay();
                                    });
                                },
                                readOnly: true
                            },
                            {
                                name: 'insertQuery',
                                bindKey: 'Alt-Shift-Q',
                                exec: function exec() {
                                    $scope.$apply(function () {
                                        openQueryBuilderOverlay();
                                    });
                                },
                                readOnly: true
                            },
                            {
                                name: 'insertSection',
                                bindKey: 'Alt-Shift-S',
                                exec: function exec() {
                                    $scope.$apply(function () {
                                        openSectionsOverlay();
                                    });
                                },
                                readOnly: true
                            },
                            {
                                name: 'chooseMasterTemplate',
                                bindKey: 'Alt-Shift-T',
                                exec: function exec() {
                                    $scope.$apply(function () {
                                        openMasterTemplateOverlay();
                                    });
                                },
                                readOnly: true
                            }
                        ]);
                        // initial cursor placement
                        // Keep cursor in name field if we are create a new template
                        // else set the cursor at the bottom of the code editor
                        if (!create) {
                            $timeout(function () {
                                vm.editor.navigateFileEnd();
                                vm.editor.focus();
                                persistCurrentLocation();
                            });
                        }
                        //change on blur, focus
                        vm.editor.on('blur', persistCurrentLocation);
                        vm.editor.on('focus', persistCurrentLocation);
                        vm.editor.on('change', changeAceEditor);
                    }
                };
            };
            vm.openPageFieldOverlay = openPageFieldOverlay;
            vm.openDictionaryItemOverlay = openDictionaryItemOverlay;
            vm.openQueryBuilderOverlay = openQueryBuilderOverlay;
            vm.openMacroOverlay = openMacroOverlay;
            vm.openInsertOverlay = openInsertOverlay;
            vm.openSectionsOverlay = openSectionsOverlay;
            vm.openPartialOverlay = openPartialOverlay;
            vm.openMasterTemplateOverlay = openMasterTemplateOverlay;
            vm.selectMasterTemplate = selectMasterTemplate;
            vm.getMasterTemplateName = getMasterTemplateName;
            vm.removeMasterTemplate = removeMasterTemplate;
            vm.closeShortcuts = closeShortcuts;
            vm.submit = submit;
            vm.close = close;
            function openInsertOverlay() {
                var insertOverlay = {
                    allowedTypes: {
                        macro: true,
                        dictionary: true,
                        partial: true,
                        umbracoField: true
                    },
                    submit: function submit(model) {
                        switch (model.insert.type) {
                        case 'macro':
                            var macroObject = macroService.collectValueData(model.insert.selectedMacro, model.insert.macroParams, 'Mvc');
                            insert(macroObject.syntax);
                            break;
                        case 'dictionary':
                            var code = templateHelper.getInsertDictionarySnippet(model.insert.node.name);
                            insert(code);
                            break;
                        case 'partial':
                            var code = templateHelper.getInsertPartialSnippet(model.insert.node.parentId, model.insert.node.name);
                            insert(code);
                            break;
                        case 'umbracoField':
                            insert(model.insert.umbracoField);
                            break;
                        }
                        editorService.close();
                    },
                    close: function close(oldModel) {
                        // close the dialog
                        editorService.close();
                        // focus editor
                        vm.editor.focus();
                    }
                };
                editorService.insertCodeSnippet(insertOverlay);
            }
            function openMacroOverlay() {
                var macroPicker = {
                    dialogData: {},
                    submit: function submit(model) {
                        var macroObject = macroService.collectValueData(model.selectedMacro, model.macroParams, 'Mvc');
                        insert(macroObject.syntax);
                        editorService.close();
                    },
                    close: function close() {
                        editorService.close();
                        vm.editor.focus();
                    }
                };
                editorService.macroPicker(macroPicker);
            }
            function openPageFieldOverlay() {
                var insertFieldEditor = {
                    submit: function submit(model) {
                        insert(model.umbracoField);
                        editorService.close();
                    },
                    close: function close() {
                        editorService.close();
                        vm.editor.focus();
                    }
                };
                editorService.insertField(insertFieldEditor);
            }
            function openDictionaryItemOverlay() {
                var labelKeys = [
                    'template_insertDictionaryItem',
                    'emptyStates_emptyDictionaryTree'
                ];
                localizationService.localizeMany(labelKeys).then(function (values) {
                    var title = values[0];
                    var emptyStateMessage = values[1];
                    var dictionaryItem = {
                        section: 'translation',
                        treeAlias: 'dictionary',
                        entityType: 'dictionary',
                        multiPicker: false,
                        title: title,
                        emptyStateMessage: emptyStateMessage,
                        select: function select(node) {
                            var code = templateHelper.getInsertDictionarySnippet(node.name);
                            insert(code);
                            editorService.close();
                        },
                        close: function close(model) {
                            // close dialog
                            editorService.close();
                            // focus editor
                            vm.editor.focus();
                        }
                    };
                    editorService.treePicker(dictionaryItem);
                });
            }
            function openPartialOverlay() {
                localizationService.localize('template_insertPartialView').then(function (value) {
                    var title = value;
                    var partialItem = {
                        section: 'settings',
                        treeAlias: 'partialViews',
                        entityType: 'partialView',
                        multiPicker: false,
                        title: title,
                        filter: function filter(i) {
                            if (i.name.indexOf('.cshtml') === -1 && i.name.indexOf('.vbhtml') === -1) {
                                return true;
                            }
                        },
                        filterCssClass: 'not-allowed',
                        select: function select(node) {
                            var code = templateHelper.getInsertPartialSnippet(node.parentId, node.name);
                            insert(code);
                            editorService.close();
                        },
                        close: function close(model) {
                            // close dialog
                            editorService.close();
                            // focus editor
                            vm.editor.focus();
                        }
                    };
                    editorService.treePicker(partialItem);
                });
            }
            function openQueryBuilderOverlay() {
                var queryBuilder = {
                    submit: function submit(model) {
                        var code = templateHelper.getQuerySnippet(model.result.queryExpression);
                        insert(code);
                        editorService.close();
                    },
                    close: function close() {
                        editorService.close();
                        // focus editor
                        vm.editor.focus();
                    }
                };
                editorService.queryBuilder(queryBuilder);
            }
            function openSectionsOverlay() {
                var templateSections = {
                    isMaster: vm.template.isMasterTemplate,
                    submit: function submit(model) {
                        if (model.insertType === 'renderBody') {
                            var code = templateHelper.getRenderBodySnippet();
                            insert(code);
                        }
                        if (model.insertType === 'renderSection') {
                            var code = templateHelper.getRenderSectionSnippet(model.renderSectionName, model.mandatoryRenderSection);
                            insert(code);
                        }
                        if (model.insertType === 'addSection') {
                            var code = templateHelper.getAddSectionSnippet(model.sectionName);
                            wrap(code);
                        }
                        editorService.close();
                    },
                    close: function close(model) {
                        editorService.close();
                        vm.editor.focus();
                    }
                };
                editorService.templateSections(templateSections);
            }
            function openMasterTemplateOverlay() {
                // make collection of available master templates
                var availableMasterTemplates = [];
                // filter out the current template and the selected master template
                angular.forEach(vm.templates, function (template) {
                    if (template.alias !== vm.template.alias && template.alias !== vm.template.masterTemplateAlias) {
                        var templatePathArray = template.path.split(',');
                        // filter descendant templates of current template
                        if (templatePathArray.indexOf(String(vm.template.id)) === -1) {
                            availableMasterTemplates.push(template);
                        }
                    }
                });
                localizationService.localize('template_mastertemplate').then(function (value) {
                    var title = value;
                    var masterTemplate = {
                        title: title,
                        availableItems: availableMasterTemplates,
                        submit: function submit(model) {
                            var template = model.selectedItem;
                            if (template && template.alias) {
                                vm.template.masterTemplateAlias = template.alias;
                                setLayout(template.alias + '.cshtml');
                            } else {
                                vm.template.masterTemplateAlias = null;
                                setLayout(null);
                            }
                            editorService.close();
                        },
                        close: function close(oldModel) {
                            // close dialog
                            editorService.close();
                            // focus editor
                            vm.editor.focus();
                        }
                    };
                    editorService.itemPicker(masterTemplate);
                });
            }
            function selectMasterTemplate(template) {
                if (template && template.alias) {
                    vm.template.masterTemplateAlias = template.alias;
                    setLayout(template.alias + '.cshtml');
                } else {
                    vm.template.masterTemplateAlias = null;
                    setLayout(null);
                }
            }
            function getMasterTemplateName(masterTemplateAlias, templates) {
                if (masterTemplateAlias) {
                    var templateName = '';
                    angular.forEach(templates, function (template) {
                        if (template.alias === masterTemplateAlias) {
                            templateName = template.name;
                        }
                    });
                    return templateName;
                }
            }
            function removeMasterTemplate() {
                vm.template.masterTemplateAlias = null;
                // call set layout with no paramters to set layout to null
                setLayout();
            }
            function setLayout(templatePath) {
                var templateCode = vm.editor.getValue();
                var newValue = templatePath;
                var layoutDefRegex = new RegExp('(@{[\\s\\S]*?Layout\\s*?=\\s*?)("[^"]*?"|null)(;[\\s\\S]*?})', 'gi');
                if (newValue !== undefined && newValue !== '') {
                    if (layoutDefRegex.test(templateCode)) {
                        // Declaration exists, so just update it
                        templateCode = templateCode.replace(layoutDefRegex, '$1"' + newValue + '"$3');
                    } else {
                        // Declaration doesn't exist, so prepend to start of doc
                        //TODO: Maybe insert at the cursor position, rather than just at the top of the doc?
                        templateCode = '@{\n\tLayout = "' + newValue + '";\n}\n' + templateCode;
                    }
                } else {
                    if (layoutDefRegex.test(templateCode)) {
                        // Declaration exists, so just update it
                        templateCode = templateCode.replace(layoutDefRegex, '$1null$3');
                    }
                }
                vm.editor.setValue(templateCode);
                vm.editor.clearSelection();
                vm.editor.navigateFileStart();
                vm.editor.focus();
                // set form state to $dirty
                setFormState('dirty');
            }
            function insert(str) {
                vm.editor.focus();
                vm.editor.moveCursorToPosition(vm.currentPosition);
                vm.editor.insert(str);
                // set form state to $dirty
                setFormState('dirty');
            }
            function wrap(str) {
                var selectedContent = vm.editor.session.getTextRange(vm.editor.getSelectionRange());
                str = str.replace('{0}', selectedContent);
                vm.editor.insert(str);
                vm.editor.focus();
                // set form state to $dirty
                setFormState('dirty');
            }
            function persistCurrentLocation() {
                vm.currentPosition = vm.editor.getCursorPosition();
            }
            function changeAceEditor() {
                setFormState('dirty');
            }
            function setFormState(state) {
                // get the current form
                var currentForm = angularHelper.getCurrentForm($scope);
                // set state
                if (state === 'dirty') {
                    currentForm.$setDirty();
                } else if (state === 'pristine') {
                    currentForm.$setPristine();
                }
            }
            function closeShortcuts() {
                vm.showKeyboardShortcut = false;
            }
            function submit() {
                if ($scope.model.submit) {
                    $scope.model.template = vm.template;
                    $scope.model.submit($scope.model);
                }
            }
            function close() {
                if ($scope.model.close) {
                    $scope.model.close();
                }
            }
            vm.init();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Templates.EditController', TemplatesEditController);
    }());
    'use strict';
    (function () {
        'use strict';
        function UserGroupEditController($scope, $location, $routeParams, userGroupsResource, localizationService, contentEditingHelper, editorService) {
            var vm = this;
            var contentPickerOpen = false;
            vm.page = {};
            vm.page.rootIcon = 'icon-folder';
            vm.userGroup = {};
            vm.labels = {};
            vm.showBackButton = true;
            vm.goToPage = goToPage;
            vm.openSectionPicker = openSectionPicker;
            vm.openContentPicker = openContentPicker;
            vm.openMediaPicker = openMediaPicker;
            vm.openUserPicker = openUserPicker;
            vm.removeSelectedItem = removeSelectedItem;
            vm.clearStartNode = clearStartNode;
            vm.save = save;
            vm.openGranularPermissionsPicker = openGranularPermissionsPicker;
            vm.setPermissionsForNode = setPermissionsForNode;
            function init() {
                vm.loading = true;
                var labelKeys = [
                    'general_cancel',
                    'defaultdialogs_selectContentStartNode',
                    'defaultdialogs_selectMediaStartNode',
                    'defaultdialogs_selectNode',
                    'general_groups',
                    'content_contentRoot',
                    'media_mediaRoot'
                ];
                localizationService.localizeMany(labelKeys).then(function (values) {
                    vm.labels.cancel = values[0];
                    vm.labels.selectContentStartNode = values[1];
                    vm.labels.selectMediaStartNode = values[2];
                    vm.labels.selectNode = values[3];
                    vm.labels.groups = values[4];
                    vm.labels.contentRoot = values[5];
                    vm.labels.mediaRoot = values[6];
                });
                localizationService.localize('general_add').then(function (name) {
                    vm.labels.add = name;
                });
                localizationService.localize('user_noStartNode').then(function (name) {
                    vm.labels.noStartNode = name;
                });
                if ($routeParams.create) {
                    // get user group scaffold
                    userGroupsResource.getUserGroupScaffold().then(function (userGroup) {
                        vm.userGroup = userGroup;
                        setSectionIcon(vm.userGroup.sections);
                        makeBreadcrumbs();
                        vm.loading = false;
                    });
                } else {
                    // get user group
                    userGroupsResource.getUserGroup($routeParams.id).then(function (userGroup) {
                        vm.userGroup = userGroup;
                        formatGranularPermissionSelection();
                        setSectionIcon(vm.userGroup.sections);
                        makeBreadcrumbs();
                        vm.loading = false;
                    });
                }
            }
            function save() {
                vm.page.saveButtonState = 'busy';
                contentEditingHelper.contentEditorPerformSave({
                    saveMethod: userGroupsResource.saveUserGroup,
                    scope: $scope,
                    content: vm.userGroup,
                    // We do not redirect on failure for users - this is because it is not possible to actually save a user
                    // when server side validation fails - as opposed to content where we are capable of saving the content
                    // item if server side validation fails
                    redirectOnFailure: false,
                    rebindCallback: function rebindCallback(orignal, saved) {
                    }
                }).then(function (saved) {
                    vm.userGroup = saved;
                    formatGranularPermissionSelection();
                    setSectionIcon(vm.userGroup.sections);
                    makeBreadcrumbs();
                    vm.page.saveButtonState = 'success';
                }, function (err) {
                    vm.page.saveButtonState = 'error';
                });
            }
            function goToPage(ancestor) {
                $location.path(ancestor.path).search('subview', ancestor.subView);
            }
            function openSectionPicker() {
                var oldSelection = angular.copy(vm.userGroup.sections);
                var sectionPicker = {
                    selection: vm.userGroup.sections,
                    submit: function submit(model) {
                        editorService.close();
                    },
                    close: function close() {
                        vm.userGroup.sections = oldSelection;
                        editorService.close();
                    }
                };
                editorService.sectionPicker(sectionPicker);
            }
            function openContentPicker() {
                var contentPicker = {
                    title: vm.labels.selectContentStartNode,
                    section: 'content',
                    treeAlias: 'content',
                    hideSubmitButton: true,
                    hideHeader: false,
                    submit: function submit(model) {
                        if (model.selection) {
                            vm.userGroup.contentStartNode = model.selection[0];
                            if (vm.userGroup.contentStartNode.id === '-1') {
                                vm.userGroup.contentStartNode.name = vm.labels.contentRoot;
                                vm.userGroup.contentStartNode.icon = 'icon-folder';
                            }
                        }
                        editorService.close();
                    },
                    close: function close() {
                        editorService.close();
                    }
                };
                editorService.treePicker(contentPicker);
            }
            function openMediaPicker() {
                var mediaPicker = {
                    title: vm.labels.selectMediaStartNode,
                    section: 'media',
                    treeAlias: 'media',
                    entityType: 'media',
                    hideSubmitButton: true,
                    hideHeader: false,
                    submit: function submit(model) {
                        if (model.selection) {
                            vm.userGroup.mediaStartNode = model.selection[0];
                            if (vm.userGroup.mediaStartNode.id === '-1') {
                                vm.userGroup.mediaStartNode.name = vm.labels.mediaRoot;
                                vm.userGroup.mediaStartNode.icon = 'icon-folder';
                            }
                        }
                        editorService.close();
                    },
                    close: function close() {
                        editorService.close();
                    }
                };
                editorService.treePicker(mediaPicker);
            }
            function openUserPicker() {
                var oldSelection = angular.copy(vm.userGroup.users);
                var userPicker = {
                    selection: vm.userGroup.users,
                    submit: function submit() {
                        editorService.close();
                    },
                    close: function close() {
                        vm.userGroup.users = oldSelection;
                        editorService.close();
                    }
                };
                editorService.userPicker(userPicker);
            }
            /**
     * The granular permissions structure gets returned from the server in the dictionary format with each key being the permission category
     * however the list to display the permissions isn't via the dictionary way so we need to format it
     */
            function formatGranularPermissionSelection() {
                angular.forEach(vm.userGroup.assignedPermissions, function (node) {
                    formatGranularPermissionSelectionForNode(node);
                });
            }
            function formatGranularPermissionSelectionForNode(node) {
                //the dictionary is assigned via node.permissions we will reformat to node.allowedPermissions
                node.allowedPermissions = [];
                angular.forEach(node.permissions, function (permissions, key) {
                    angular.forEach(permissions, function (p) {
                        if (p.checked) {
                            node.allowedPermissions.push(p);
                        }
                    });
                });
            }
            function openGranularPermissionsPicker() {
                var contentPicker = {
                    title: vm.labels.selectNode,
                    section: 'content',
                    treeAlias: 'content',
                    hideSubmitButton: true,
                    submit: function submit(model) {
                        if (model.selection) {
                            var node = model.selection[0];
                            //check if this is already in our selection
                            var found = _.find(vm.userGroup.assignedPermissions, function (i) {
                                return i.id === node.id;
                            });
                            node = found ? found : node;
                            setPermissionsForNode(node);
                        }
                    },
                    close: function close() {
                        editorService.close();
                    }
                };
                editorService.treePicker(contentPicker);
                contentPickerOpen = true;
            }
            function setPermissionsForNode(node) {
                //clone the current defaults to pass to the model
                if (!node.permissions) {
                    node.permissions = angular.copy(vm.userGroup.defaultPermissions);
                }
                vm.nodePermissions = {
                    node: node,
                    submit: function submit(model) {
                        if (model && model.node && model.node.permissions) {
                            formatGranularPermissionSelectionForNode(node);
                            if (!vm.userGroup.assignedPermissions) {
                                vm.userGroup.assignedPermissions = [];
                            }
                            //check if this is already in our selection
                            var found = _.find(vm.userGroup.assignedPermissions, function (i) {
                                return i.id === node.id;
                            });
                            if (!found) {
                                vm.userGroup.assignedPermissions.push(node);
                            }
                        }
                        editorService.close();
                        if (contentPickerOpen) {
                            editorService.close();
                            contentPickerOpen = false;
                        }
                    },
                    close: function close() {
                        editorService.close();
                    }
                };
                editorService.nodePermissions(vm.nodePermissions);
            }
            function removeSelectedItem(index, selection) {
                if (selection && selection.length > 0) {
                    selection.splice(index, 1);
                }
            }
            function clearStartNode(type) {
                if (type === 'content') {
                    vm.userGroup.contentStartNode = null;
                } else if (type === 'media') {
                    vm.userGroup.mediaStartNode = null;
                }
            }
            function makeBreadcrumbs() {
                vm.breadcrumbs = [
                    {
                        'name': vm.labels.groups,
                        'path': '/users/users/overview',
                        'subView': 'groups'
                    },
                    { 'name': vm.userGroup.name }
                ];
            }
            function setSectionIcon(sections) {
                angular.forEach(sections, function (section) {
                    section.icon = 'icon-section ' + section.cssclass;
                });
            }
            init();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Users.GroupController', UserGroupEditController);
    }());
    'use strict';
    (function () {
        'use strict';
        function UsersOverviewController($scope, $location, $timeout, navigationService, localizationService) {
            var vm = this;
            var usersUri = $location.search().subview;
            if (!usersUri) {
                $location.search('subview', 'users');
                //exit after this, we don't want to initialize anything further since this
                //is going to change the route
                return;
            }
            //note on the below, we dont assign a view unless it's the right route since if we did that it will load in that controller
            //for the view which is unecessary and will cause extra overhead/requests to occur
            vm.page = {};
            vm.page.labels = {};
            vm.page.name = '';
            vm.page.navigation = [];
            function onInit() {
                loadNavigation();
                setPageName();
                $timeout(function () {
                    navigationService.syncTree({
                        tree: 'users',
                        path: '-1'
                    });
                });
            }
            function loadNavigation() {
                var labels = [
                    'sections_users',
                    'general_groups'
                ];
                localizationService.localizeMany(labels).then(function (data) {
                    vm.page.labels.users = data[0];
                    vm.page.labels.groups = data[1];
                    vm.page.navigation = [
                        {
                            'name': vm.page.labels.users,
                            'icon': 'icon-user',
                            'action': function action() {
                                $location.search('subview', 'users');
                            },
                            'view': !usersUri || usersUri === 'users' ? 'views/users/views/users/users.html' : null,
                            'active': !usersUri || usersUri === 'users',
                            'alias': 'users'
                        },
                        {
                            'name': vm.page.labels.groups,
                            'icon': 'icon-users',
                            'action': function action() {
                                $location.search('subview', 'groups');
                            },
                            'view': usersUri === 'groups' ? 'views/users/views/groups/groups.html' : null,
                            'active': usersUri === 'groups',
                            'alias': 'userGroups'
                        }
                    ];
                });
            }
            function setPageName() {
                localizationService.localize('user_userManagement').then(function (data) {
                    vm.page.name = data;
                });
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Users.OverviewController', UsersOverviewController);
    }());
    'use strict';
    (function () {
        'use strict';
        function UserEditController($scope, eventsService, $q, $timeout, $location, $routeParams, formHelper, usersResource, userService, contentEditingHelper, localizationService, notificationsService, mediaHelper, Upload, umbRequestHelper, usersHelper, authResource, dateHelper, editorService) {
            var vm = this;
            vm.page = {};
            vm.page.rootIcon = 'icon-folder';
            vm.user = { changePassword: null };
            vm.breadcrumbs = [];
            vm.avatarFile = {};
            vm.labels = {};
            vm.maxFileSize = Umbraco.Sys.ServerVariables.umbracoSettings.maxFileSize + 'KB';
            vm.acceptedFileTypes = mediaHelper.formatFileTypes(Umbraco.Sys.ServerVariables.umbracoSettings.imageFileTypes);
            vm.usernameIsEmail = Umbraco.Sys.ServerVariables.umbracoSettings.usernameIsEmail;
            //create the initial model for change password
            vm.changePasswordModel = {
                config: {},
                isChanging: false
            };
            vm.goToPage = goToPage;
            vm.openUserGroupPicker = openUserGroupPicker;
            vm.openContentPicker = openContentPicker;
            vm.openMediaPicker = openMediaPicker;
            vm.removeSelectedItem = removeSelectedItem;
            vm.disableUser = disableUser;
            vm.enableUser = enableUser;
            vm.unlockUser = unlockUser;
            vm.resendInvite = resendInvite;
            vm.deleteNonLoggedInUser = deleteNonLoggedInUser;
            vm.changeAvatar = changeAvatar;
            vm.clearAvatar = clearAvatar;
            vm.save = save;
            vm.toggleChangePassword = toggleChangePassword;
            function init() {
                vm.loading = true;
                var labelKeys = [
                    'general_saving',
                    'general_cancel',
                    'defaultdialogs_selectContentStartNode',
                    'defaultdialogs_selectMediaStartNode',
                    'sections_users',
                    'content_contentRoot',
                    'media_mediaRoot',
                    'user_noStartNodes',
                    'user_defaultInvitationMessage',
                    'user_deleteUserConfirmation'
                ];
                localizationService.localizeMany(labelKeys).then(function (values) {
                    vm.labels.saving = values[0];
                    vm.labels.cancel = values[1];
                    vm.labels.selectContentStartNode = values[2];
                    vm.labels.selectMediaStartNode = values[3];
                    vm.labels.users = values[4];
                    vm.labels.contentRoot = values[5];
                    vm.labels.mediaRoot = values[6];
                    vm.labels.noStartNodes = values[7];
                    vm.labels.defaultInvitationMessage = values[8];
                    vm.labels.deleteUserConfirmation = values[9];
                });
                // get user
                usersResource.getUser($routeParams.id).then(function (user) {
                    vm.user = user;
                    makeBreadcrumbs(vm.user);
                    setUserDisplayState();
                    formatDatesToLocal(vm.user);
                    vm.usernameIsEmail = Umbraco.Sys.ServerVariables.umbracoSettings.usernameIsEmail && user.email === user.username;
                    //go get the config for the membership provider and add it to the model
                    authResource.getMembershipProviderConfig().then(function (data) {
                        vm.changePasswordModel.config = data;
                        //the user has a password if they are not states: Invited, NoCredentials
                        vm.changePasswordModel.config.hasPassword = vm.user.userState !== 3 && vm.user.userState !== 4;
                        vm.changePasswordModel.config.disableToggle = true;
                        //this is only relavent for membership providers now (it's basically obsolete)
                        vm.changePasswordModel.config.enableReset = false;
                        //in the ASP.NET Identity world, this config option will allow an admin user to change another user's password
                        //if the user has access to the user section. So if this editor is being access, the user of course has access to this section.
                        //the authorization check is also done on the server side when submitted.
                        // only update the setting if not the current logged in user, otherwise leave the value as it is
                        // currently set in the web.config
                        if (!vm.user.isCurrentUser) {
                            vm.changePasswordModel.config.allowManuallyChangingPassword = true;
                        }
                        vm.loading = false;
                    });
                });
            }
            function getLocalDate(date, culture, format) {
                if (date) {
                    var dateVal;
                    var serverOffset = Umbraco.Sys.ServerVariables.application.serverTimeOffset;
                    var localOffset = new Date().getTimezoneOffset();
                    var serverTimeNeedsOffsetting = -serverOffset !== localOffset;
                    if (serverTimeNeedsOffsetting) {
                        dateVal = dateHelper.convertToLocalMomentTime(date, serverOffset);
                    } else {
                        dateVal = moment(date, 'YYYY-MM-DD HH:mm:ss');
                    }
                    return dateVal.locale(culture).format(format);
                }
            }
            function toggleChangePassword() {
                vm.changePasswordModel.isChanging = !vm.changePasswordModel.isChanging;
                //reset it
                vm.user.changePassword = null;
            }
            function save() {
                if (formHelper.submitForm({ scope: $scope })) {
                    //anytime a user is changing another user's password, we are in effect resetting it so we need to set that flag here
                    if (vm.user.changePassword) {
                        vm.user.changePassword.reset = !vm.user.changePassword.oldPassword && !vm.user.isCurrentUser;
                    }
                    vm.page.saveButtonState = 'busy';
                    vm.user.resetPasswordValue = null;
                    //save current nav to be restored later so that the tabs dont change
                    var currentNav = vm.user.navigation;
                    usersResource.saveUser(vm.user).then(function (saved) {
                        //if the user saved, then try to execute all extended save options
                        extendedSave(saved).then(function (result) {
                            //if all is good, then reset the form
                            formHelper.resetForm({ scope: $scope });
                        }, angular.noop);
                        vm.user = _.omit(saved, 'navigation');
                        //restore
                        vm.user.navigation = currentNav;
                        setUserDisplayState();
                        formatDatesToLocal(vm.user);
                        vm.changePasswordModel.isChanging = false;
                        //the user has a password if they are not states: Invited, NoCredentials
                        vm.changePasswordModel.config.hasPassword = vm.user.userState !== 3 && vm.user.userState !== 4;
                        vm.page.saveButtonState = 'success';
                    }, function (err) {
                        contentEditingHelper.handleSaveError({
                            redirectOnFailure: false,
                            err: err
                        });
                        vm.page.saveButtonState = 'error';
                    });
                }
            }
            /**
     * Used to emit the save event and await any async operations being performed by editor extensions
     * @param {any} savedUser
     */
            function extendedSave(savedUser) {
                //used to track any promises added by the event handlers to be awaited
                var promises = [];
                var args = {
                    //getPromise: getPromise,
                    user: savedUser,
                    //a promise can be added by the event handler if the handler needs an async operation to be awaited
                    addPromise: function addPromise(p) {
                        promises.push(p);
                    }
                };
                //emit the event
                eventsService.emit('editors.user.editController.save', args);
                //await all promises to complete
                var resultPromise = $q.all(promises);
                return resultPromise;
            }
            function goToPage(ancestor) {
                $location.path(ancestor.path).search('subview', ancestor.subView);
            }
            function openUserGroupPicker() {
                var oldSelection = angular.copy(vm.user.userGroups);
                var userGroupPicker = {
                    selection: vm.user.userGroups,
                    submit: function submit(model) {
                        // apply changes
                        if (model.selection) {
                            vm.user.userGroups = model.selection;
                        }
                        editorService.close();
                    },
                    close: function close() {
                        // roll back the selection
                        vm.user.userGroups = oldSelection;
                        editorService.close();
                    }
                };
                editorService.userGroupPicker(userGroupPicker);
            }
            function openContentPicker() {
                var contentPicker = {
                    title: vm.labels.selectContentStartNode,
                    section: 'content',
                    treeAlias: 'content',
                    multiPicker: true,
                    selection: vm.user.startContentIds,
                    hideHeader: false,
                    submit: function submit(model) {
                        // select items
                        if (model.selection) {
                            angular.forEach(model.selection, function (item) {
                                if (item.id === '-1') {
                                    item.name = vm.labels.contentRoot;
                                    item.icon = 'icon-folder';
                                }
                                multiSelectItem(item, vm.user.startContentIds);
                            });
                        }
                        editorService.close();
                    },
                    close: function close() {
                        editorService.close();
                    }
                };
                editorService.treePicker(contentPicker);
            }
            function openMediaPicker() {
                var mediaPicker = {
                    title: vm.labels.selectMediaStartNode,
                    section: 'media',
                    treeAlias: 'media',
                    entityType: 'media',
                    multiPicker: true,
                    hideHeader: false,
                    show: true,
                    submit: function submit(model) {
                        // select items
                        if (model.selection) {
                            angular.forEach(model.selection, function (item) {
                                if (item.id === '-1') {
                                    item.name = vm.labels.mediaRoot;
                                    item.icon = 'icon-folder';
                                }
                                multiSelectItem(item, vm.user.startMediaIds);
                            });
                        }
                        // close overlay
                        editorService.close();
                    },
                    close: function close() {
                        // close overlay
                        editorService.close();
                    }
                };
                editorService.treePicker(mediaPicker);
            }
            function multiSelectItem(item, selection) {
                var found = false;
                // check if item is already in the selected list
                if (selection.length > 0) {
                    angular.forEach(selection, function (selectedItem) {
                        if (selectedItem.udi === item.udi) {
                            found = true;
                        }
                    });
                }
                // only add the selected item if it is not already selected
                if (!found) {
                    selection.push(item);
                }
            }
            function removeSelectedItem(index, selection) {
                selection.splice(index, 1);
            }
            function disableUser() {
                vm.disableUserButtonState = 'busy';
                usersResource.disableUsers([vm.user.id]).then(function (data) {
                    vm.user.userState = 1;
                    setUserDisplayState();
                    vm.disableUserButtonState = 'success';
                }, function (error) {
                    vm.disableUserButtonState = 'error';
                });
            }
            function enableUser() {
                vm.enableUserButtonState = 'busy';
                usersResource.enableUsers([vm.user.id]).then(function (data) {
                    vm.user.userState = 0;
                    setUserDisplayState();
                    vm.enableUserButtonState = 'success';
                }, function (error) {
                    vm.enableUserButtonState = 'error';
                });
            }
            function unlockUser() {
                vm.unlockUserButtonState = 'busy';
                usersResource.unlockUsers([vm.user.id]).then(function (data) {
                    vm.user.userState = 0;
                    vm.user.failedPasswordAttempts = 0;
                    setUserDisplayState();
                    vm.unlockUserButtonState = 'success';
                }, function (error) {
                    vm.unlockUserButtonState = 'error';
                });
            }
            function resendInvite() {
                vm.resendInviteButtonState = 'busy';
                if (vm.resendInviteMessage) {
                    vm.user.message = vm.resendInviteMessage;
                } else {
                    vm.user.message = vm.labels.defaultInvitationMessage;
                }
                usersResource.inviteUser(vm.user).then(function (data) {
                    vm.resendInviteButtonState = 'success';
                    vm.resendInviteMessage = '';
                    formHelper.showNotifications(data);
                }, function (error) {
                    vm.resendInviteButtonState = 'error';
                    formHelper.showNotifications(error.data);
                });
            }
            function deleteNonLoggedInUser() {
                vm.deleteNotLoggedInUserButtonState = 'busy';
                var confirmationMessage = vm.labels.deleteUserConfirmation;
                if (!confirm(confirmationMessage)) {
                    vm.deleteNotLoggedInUserButtonState = 'danger';
                    return;
                }
                usersResource.deleteNonLoggedInUser(vm.user.id).then(function (data) {
                    formHelper.showNotifications(data);
                    goToPage(vm.breadcrumbs[0]);
                }, function (error) {
                    vm.deleteNotLoggedInUserButtonState = 'error';
                    formHelper.showNotifications(error.data);
                });
            }
            function clearAvatar() {
                // get user
                usersResource.clearAvatar(vm.user.id).then(function (data) {
                    vm.user.avatars = data;
                });
            }
            function changeAvatar(files, event) {
                if (files && files.length > 0) {
                    upload(files[0]);
                }
            }
            ;
            function upload(file) {
                vm.avatarFile.uploadProgress = 0;
                Upload.upload({
                    url: umbRequestHelper.getApiUrl('userApiBaseUrl', 'PostSetAvatar', { id: vm.user.id }),
                    fields: {},
                    file: file
                }).progress(function (evt) {
                    if (vm.avatarFile.uploadStatus !== 'done' && vm.avatarFile.uploadStatus !== 'error') {
                        // set uploading status on file
                        vm.avatarFile.uploadStatus = 'uploading';
                        // calculate progress in percentage
                        var progressPercentage = parseInt(100 * evt.loaded / evt.total, 10);
                        // set percentage property on file
                        vm.avatarFile.uploadProgress = progressPercentage;
                    }
                }).success(function (data, status, headers, config) {
                    // set done status on file
                    vm.avatarFile.uploadStatus = 'done';
                    vm.avatarFile.uploadProgress = 100;
                    vm.user.avatars = data;
                }).error(function (evt, status, headers, config) {
                    // set status done
                    vm.avatarFile.uploadStatus = 'error';
                    // If file not found, server will return a 404 and display this message
                    if (status === 404) {
                        vm.avatarFile.serverErrorMessage = 'File not found';
                    } else if (status == 400) {
                        //it's a validation error
                        vm.avatarFile.serverErrorMessage = evt.message;
                    } else {
                        //it's an unhandled error
                        //if the service returns a detailed error
                        if (evt.InnerException) {
                            vm.avatarFile.serverErrorMessage = evt.InnerException.ExceptionMessage;
                            //Check if its the common "too large file" exception
                            if (evt.InnerException.StackTrace && evt.InnerException.StackTrace.indexOf('ValidateRequestEntityLength') > 0) {
                                vm.avatarFile.serverErrorMessage = 'File too large to upload';
                            }
                        } else if (evt.Message) {
                            vm.avatarFile.serverErrorMessage = evt.Message;
                        }
                    }
                });
            }
            function makeBreadcrumbs() {
                vm.breadcrumbs = [
                    {
                        'name': vm.labels.users,
                        'path': '/users/users/overview',
                        'subView': 'users'
                    },
                    { 'name': vm.user.name }
                ];
            }
            function setUserDisplayState() {
                vm.user.userDisplayState = usersHelper.getUserStateFromValue(vm.user.userState);
            }
            function formatDatesToLocal(user) {
                // get current backoffice user and format dates
                userService.getCurrentUser().then(function (currentUser) {
                    user.formattedLastLogin = getLocalDate(user.lastLoginDate, currentUser.locale, 'LLL');
                    user.formattedLastLockoutDate = getLocalDate(user.lastLockoutDate, currentUser.locale, 'LLL');
                    user.formattedCreateDate = getLocalDate(user.createDate, currentUser.locale, 'LLL');
                    user.formattedUpdateDate = getLocalDate(user.updateDate, currentUser.locale, 'LLL');
                    user.formattedLastPasswordChangeDate = getLocalDate(user.lastPasswordChangeDate, currentUser.locale, 'LLL');
                });
            }
            init();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Users.UserController', UserEditController);
    }());
    'use strict';
    (function () {
        'use strict';
        function UserGroupsController($scope, $timeout, $location, userService, userGroupsResource, formHelper, localizationService) {
            var vm = this;
            vm.userGroups = [];
            vm.selection = [];
            vm.createUserGroup = createUserGroup;
            vm.goToUserGroup = goToUserGroup;
            vm.clearSelection = clearSelection;
            vm.selectUserGroup = selectUserGroup;
            vm.deleteUserGroups = deleteUserGroups;
            var currentUser = null;
            function onInit() {
                vm.loading = true;
                userService.getCurrentUser().then(function (user) {
                    currentUser = user;
                    // Get usergroups
                    userGroupsResource.getUserGroups({ onlyCurrentUserGroups: false }).then(function (userGroups) {
                        // only allow editing and selection if user is member of the group or admin
                        vm.userGroups = _.map(userGroups, function (ug) {
                            return {
                                group: ug,
                                hasAccess: user.userGroups.indexOf(ug.alias) !== -1 || user.userGroups.indexOf('admin') !== -1
                            };
                        });
                        vm.loading = false;
                    });
                });
            }
            function createUserGroup() {
                // clear all query params
                $location.search({});
                // go to create user group
                $location.path('users/users/group/-1').search('create', 'true');
                ;
            }
            function goToUserGroup(userGroup) {
                // only allow editing if user is member of the group or admin
                if (currentUser.userGroups.indexOf(userGroup.group.alias) === -1 && currentUser.userGroups.indexOf('admin') === -1) {
                    return;
                }
                $location.path('users/users/group/' + userGroup.group.id).search('create', null);
            }
            function selectUserGroup(userGroup, selection, event) {
                // Only allow selection if user is member of the group or admin
                if (currentUser.userGroups.indexOf(userGroup.group.alias) === -1 && currentUser.userGroups.indexOf('admin') === -1) {
                    return;
                }
                // Disallow selection of the admin/translators group, the checkbox is not visible in the UI, but clicking(and thus selecting) is still possible.
                // Currently selection can only be used for deleting, and the Controller will also disallow deleting the admin group.
                if (userGroup.group.alias === 'admin' || userGroup.group.alias === 'translator')
                    return;
                if (userGroup.selected) {
                    var index = selection.indexOf(userGroup.group.id);
                    selection.splice(index, 1);
                    userGroup.selected = false;
                } else {
                    userGroup.selected = true;
                    vm.selection.push(userGroup.group.id);
                }
                if (event) {
                    event.stopPropagation();
                }
            }
            function deleteUserGroups() {
                if (vm.selection.length > 0) {
                    localizationService.localize('defaultdialogs_confirmdelete').then(function (value) {
                        var confirmResponse = confirm(value);
                        if (confirmResponse === true) {
                            userGroupsResource.deleteUserGroups(vm.selection).then(function (data) {
                                clearSelection();
                                onInit();
                            }, angular.noop);
                        }
                    });
                }
            }
            function clearSelection() {
                angular.forEach(vm.userGroups, function (userGroup) {
                    userGroup.selected = false;
                });
                vm.selection = [];
            }
            onInit();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Users.GroupsController', UserGroupsController);
    }());
    'use strict';
    (function () {
        'use strict';
        function UsersController($scope, $timeout, $location, $routeParams, usersResource, userGroupsResource, userService, localizationService, contentEditingHelper, usersHelper, formHelper, notificationsService, dateHelper, editorService) {
            var vm = this;
            var localizeSaving = localizationService.localize('general_saving');
            vm.page = {};
            vm.users = [];
            vm.userGroups = [];
            vm.userStates = [];
            vm.selection = [];
            vm.newUser = {};
            vm.usersOptions = {};
            vm.userSortData = [
                {
                    label: 'Name (A-Z)',
                    key: 'Name',
                    direction: 'Ascending'
                },
                {
                    label: 'Name (Z-A)',
                    key: 'Name',
                    direction: 'Descending'
                },
                {
                    label: 'Newest',
                    key: 'CreateDate',
                    direction: 'Descending'
                },
                {
                    label: 'Oldest',
                    key: 'CreateDate',
                    direction: 'Ascending'
                },
                {
                    label: 'Last login',
                    key: 'LastLoginDate',
                    direction: 'Descending'
                }
            ];
            angular.forEach(vm.userSortData, function (userSortData) {
                var key = 'user_sort' + userSortData.key + userSortData.direction;
                localizationService.localize(key).then(function (value) {
                    var reg = /^\[[\S\s]*]$/g;
                    var result = reg.test(value);
                    if (result === false) {
                        // Only translate if key exists
                        userSortData.label = value;
                    }
                });
            });
            vm.userStatesFilter = [];
            vm.newUser.userGroups = [];
            vm.usersViewState = 'overview';
            vm.selectedBulkUserGroups = [];
            vm.usernameIsEmail = Umbraco.Sys.ServerVariables.umbracoSettings.usernameIsEmail;
            vm.allowDisableUser = true;
            vm.allowEnableUser = true;
            vm.allowUnlockUser = true;
            vm.allowSetUserGroup = true;
            vm.layouts = [
                {
                    'icon': 'icon-thumbnails-small',
                    'path': '1',
                    'selected': true
                },
                {
                    'icon': 'icon-list',
                    'path': '2',
                    'selected': true
                }
            ];
            vm.activeLayout = {
                'icon': 'icon-thumbnails-small',
                'path': '1',
                'selected': true
            };
            //don't show the invite button if no email is configured
            if (Umbraco.Sys.ServerVariables.umbracoSettings.showUserInvite) {
                vm.defaultButton = {
                    labelKey: 'user_inviteUser',
                    handler: function handler() {
                        vm.setUsersViewState('inviteUser');
                    }
                };
                vm.subButtons = [{
                        labelKey: 'user_createUser',
                        handler: function handler() {
                            vm.setUsersViewState('createUser');
                        }
                    }];
            } else {
                vm.defaultButton = {
                    labelKey: 'user_createUser',
                    handler: function handler() {
                        vm.setUsersViewState('createUser');
                    }
                };
            }
            vm.toggleFilter = toggleFilter;
            vm.setUsersViewState = setUsersViewState;
            vm.selectLayout = selectLayout;
            vm.selectUser = selectUser;
            vm.clearSelection = clearSelection;
            vm.clickUser = clickUser;
            vm.disableUsers = disableUsers;
            vm.enableUsers = enableUsers;
            vm.unlockUsers = unlockUsers;
            vm.openBulkUserGroupPicker = openBulkUserGroupPicker;
            vm.openUserGroupPicker = openUserGroupPicker;
            vm.removeSelectedUserGroup = removeSelectedUserGroup;
            vm.selectAll = selectAll;
            vm.areAllSelected = areAllSelected;
            vm.searchUsers = searchUsers;
            vm.getFilterName = getFilterName;
            vm.setUserStatesFilter = setUserStatesFilter;
            vm.setUserGroupFilter = setUserGroupFilter;
            vm.setOrderByFilter = setOrderByFilter;
            vm.changePageNumber = changePageNumber;
            vm.createUser = createUser;
            vm.inviteUser = inviteUser;
            vm.getSortLabel = getSortLabel;
            vm.toggleNewUserPassword = toggleNewUserPassword;
            vm.copySuccess = copySuccess;
            vm.copyError = copyError;
            vm.goToUser = goToUser;
            function init() {
                vm.usersOptions.orderBy = 'Name';
                vm.usersOptions.orderDirection = 'Ascending';
                if ($routeParams.create) {
                    setUsersViewState('createUser');
                } else if ($routeParams.invite) {
                    setUsersViewState('inviteUser');
                }
                // Get users
                getUsers();
                // Get user groups
                userGroupsResource.getUserGroups({ onlyCurrentUserGroups: false }).then(function (userGroups) {
                    vm.userGroups = userGroups;
                });
            }
            function getSortLabel(sortKey, sortDirection) {
                var found = _.find(vm.userSortData, function (i) {
                    return i.key === sortKey && i.direction === sortDirection;
                });
                return found ? found.label : sortKey;
            }
            function toggleFilter(type) {
                // hack: on-outside-click prevents us from closing the dropdown when clicking on another link
                // so I had to do this manually
                switch (type) {
                case 'state':
                    vm.page.showStatusFilter = !vm.page.showStatusFilter;
                    vm.page.showGroupFilter = false;
                    vm.page.showOrderByFilter = false;
                    break;
                case 'group':
                    vm.page.showGroupFilter = !vm.page.showGroupFilter;
                    vm.page.showStatusFilter = false;
                    vm.page.showOrderByFilter = false;
                    break;
                case 'orderBy':
                    vm.page.showOrderByFilter = !vm.page.showOrderByFilter;
                    vm.page.showStatusFilter = false;
                    vm.page.showGroupFilter = false;
                    break;
                }
            }
            function setUsersViewState(state) {
                if (state === 'createUser') {
                    clearAddUserForm();
                    $location.search('create', 'true');
                    $location.search('invite', null);
                } else if (state === 'inviteUser') {
                    $location.search('create', null);
                    $location.search('invite', 'true');
                } else if (state === 'overview') {
                    $location.search('create', null);
                    $location.search('invite', null);
                }
                vm.usersViewState = state;
            }
            function selectLayout(selectedLayout) {
                angular.forEach(vm.layouts, function (layout) {
                    layout.active = false;
                });
                selectedLayout.active = true;
                vm.activeLayout = selectedLayout;
            }
            function selectUser(user, selection, event) {
                // prevent the current user to be selected
                if (!user.isCurrentUser) {
                    if (user.selected) {
                        var index = selection.indexOf(user.id);
                        selection.splice(index, 1);
                        user.selected = false;
                    } else {
                        user.selected = true;
                        vm.selection.push(user.id);
                    }
                    setBulkActions(vm.users);
                    if (event) {
                        event.preventDefault();
                        event.stopPropagation();
                    }
                }
            }
            function clearSelection() {
                angular.forEach(vm.users, function (user) {
                    user.selected = false;
                });
                vm.selection = [];
            }
            function clickUser(user) {
                if (vm.selection.length > 0) {
                    selectUser(user, vm.selection);
                } else {
                    goToUser(user.id);
                }
            }
            function disableUsers() {
                vm.disableUserButtonState = 'busy';
                usersResource.disableUsers(vm.selection).then(function (data) {
                    // update userState
                    angular.forEach(vm.selection, function (userId) {
                        var user = getUserFromArrayById(userId, vm.users);
                        if (user) {
                            user.userState = 1;
                        }
                    });
                    // show the correct badges
                    setUserDisplayState(vm.users);
                    vm.disableUserButtonState = 'init';
                    clearSelection();
                }, function (error) {
                    vm.disableUserButtonState = 'error';
                });
            }
            function enableUsers() {
                vm.enableUserButtonState = 'busy';
                usersResource.enableUsers(vm.selection).then(function (data) {
                    // update userState
                    angular.forEach(vm.selection, function (userId) {
                        var user = getUserFromArrayById(userId, vm.users);
                        if (user) {
                            user.userState = 0;
                        }
                    });
                    // show the correct badges
                    setUserDisplayState(vm.users);
                    vm.enableUserButtonState = 'init';
                    clearSelection();
                }, function (error) {
                    vm.enableUserButtonState = 'error';
                });
            }
            function unlockUsers() {
                vm.unlockUserButtonState = 'busy';
                usersResource.unlockUsers(vm.selection).then(function (data) {
                    // update userState
                    angular.forEach(vm.selection, function (userId) {
                        var user = getUserFromArrayById(userId, vm.users);
                        if (user) {
                            user.userState = 0;
                        }
                    });
                    // show the correct badges
                    setUserDisplayState(vm.users);
                    vm.unlockUserButtonState = 'init';
                    clearSelection();
                }, function (error) {
                    vm.unlockUserButtonState = 'error';
                });
            }
            function getUserFromArrayById(userId, users) {
                return _.find(users, function (u) {
                    return u.id === userId;
                });
            }
            function openBulkUserGroupPicker() {
                var firstSelectedUser = getUserFromArrayById(vm.selection[0], vm.users);
                vm.selectedBulkUserGroups = _.clone(firstSelectedUser.userGroups);
                var userGroupPicker = {
                    selection: vm.selectedBulkUserGroups,
                    submit: function submit(model) {
                        usersResource.setUserGroupsOnUsers(model.selection, vm.selection).then(function (data) {
                            // sorting to ensure they show up in right order when updating the UI
                            vm.selectedBulkUserGroups.sort(function (a, b) {
                                return a.alias > b.alias ? 1 : a.alias < b.alias ? -1 : 0;
                            });
                            // apply changes to UI
                            _.each(vm.selection, function (userId) {
                                var user = getUserFromArrayById(userId, vm.users);
                                user.userGroups = vm.selectedBulkUserGroups;
                            });
                            vm.selectedBulkUserGroups = [];
                            editorService.close();
                            clearSelection();
                        }, angular.noop);
                    },
                    close: function close() {
                        vm.selectedBulkUserGroups = [];
                        editorService.close();
                    }
                };
                editorService.userGroupPicker(userGroupPicker);
            }
            function openUserGroupPicker() {
                var oldSelection = angular.copy(vm.newUser.userGroups);
                var userGroupPicker = {
                    selection: vm.newUser.userGroups,
                    submit: function submit(model) {
                        // apply changes
                        if (model.selection) {
                            vm.newUser.userGroups = model.selection;
                        }
                        editorService.close();
                    },
                    close: function close() {
                        // rollback on close
                        vm.newUser.userGroups = oldSelection;
                        editorService.close();
                    }
                };
                editorService.userGroupPicker(userGroupPicker);
            }
            function removeSelectedUserGroup(index, selection) {
                selection.splice(index, 1);
            }
            function selectAll() {
                if (areAllSelected()) {
                    vm.selection = [];
                    angular.forEach(vm.users, function (user) {
                        user.selected = false;
                    });
                } else {
                    // clear selection so we don't add the same user twice
                    vm.selection = [];
                    // select all users
                    angular.forEach(vm.users, function (user) {
                        // prevent the current user to be selected
                        if (!user.isCurrentUser) {
                            user.selected = true;
                            vm.selection.push(user.id);
                        }
                    });
                }
            }
            function areAllSelected() {
                // we need to check if the current user is part of the selection and 
                // subtract the user from the total selection to find out if all users are selected
                var includesCurrentUser = vm.users.some(function (user) {
                    return user.isCurrentUser === true;
                });
                if (includesCurrentUser) {
                    if (vm.selection.length === vm.users.length - 1) {
                        return true;
                    }
                } else {
                    if (vm.selection.length === vm.users.length) {
                        return true;
                    }
                }
            }
            var search = _.debounce(function () {
                $scope.$apply(function () {
                    getUsers();
                });
            }, 500);
            function searchUsers() {
                search();
            }
            function getFilterName(array) {
                var name = 'All';
                var found = false;
                angular.forEach(array, function (item) {
                    if (item.selected) {
                        if (!found) {
                            name = item.name;
                            found = true;
                        } else {
                            name = name + ', ' + item.name;
                        }
                    }
                });
                return name;
            }
            function setUserStatesFilter(userState) {
                if (!vm.usersOptions.userStates) {
                    vm.usersOptions.userStates = [];
                }
                //If the selection is "ALL" then we need to unselect everything else since this is an 'odd' filter
                if (userState.key === 'All') {
                    angular.forEach(vm.userStatesFilter, function (i) {
                        i.selected = false;
                    });
                    //we can't unselect All
                    userState.selected = true;
                    //reset the selection passed to the server
                    vm.usersOptions.userStates = [];
                } else {
                    angular.forEach(vm.userStatesFilter, function (i) {
                        if (i.key === 'All') {
                            i.selected = false;
                        }
                    });
                    var indexOfAll = vm.usersOptions.userStates.indexOf('All');
                    if (indexOfAll >= 0) {
                        vm.usersOptions.userStates.splice(indexOfAll, 1);
                    }
                }
                if (userState.selected) {
                    vm.usersOptions.userStates.push(userState.key);
                } else {
                    var index = vm.usersOptions.userStates.indexOf(userState.key);
                    vm.usersOptions.userStates.splice(index, 1);
                }
                getUsers();
            }
            function setUserGroupFilter(userGroup) {
                if (!vm.usersOptions.userGroups) {
                    vm.usersOptions.userGroups = [];
                }
                if (userGroup.selected) {
                    vm.usersOptions.userGroups.push(userGroup.alias);
                } else {
                    var index = vm.usersOptions.userGroups.indexOf(userGroup.alias);
                    vm.usersOptions.userGroups.splice(index, 1);
                }
                getUsers();
            }
            function setOrderByFilter(value, direction) {
                vm.usersOptions.orderBy = value;
                vm.usersOptions.orderDirection = direction;
                getUsers();
            }
            function changePageNumber(pageNumber) {
                vm.usersOptions.pageNumber = pageNumber;
                getUsers();
            }
            function createUser(addUserForm) {
                if (formHelper.submitForm({
                        formCtrl: addUserForm,
                        scope: $scope
                    })) {
                    vm.newUser.id = -1;
                    vm.newUser.parentId = -1;
                    vm.page.createButtonState = 'busy';
                    usersResource.createUser(vm.newUser).then(function (saved) {
                        vm.page.createButtonState = 'success';
                        vm.newUser = saved;
                        setUsersViewState('createUserSuccess');
                        getUsers();
                    }, function (err) {
                        formHelper.handleError(err);
                        vm.page.createButtonState = 'error';
                    });
                }
            }
            function inviteUser(addUserForm) {
                if (formHelper.submitForm({
                        formCtrl: addUserForm,
                        scope: $scope
                    })) {
                    vm.newUser.id = -1;
                    vm.newUser.parentId = -1;
                    vm.page.createButtonState = 'busy';
                    usersResource.inviteUser(vm.newUser).then(function (saved) {
                        //success
                        vm.page.createButtonState = 'success';
                        vm.newUser = saved;
                        setUsersViewState('inviteUserSuccess');
                        getUsers();
                    }, function (err) {
                        //error
                        formHelper.handleError(err);
                        vm.page.createButtonState = 'error';
                    });
                }
            }
            function toggleNewUserPassword() {
                vm.newUser.showPassword = !vm.newUser.showPassword;
            }
            // copy to clip board success
            function copySuccess() {
                if (vm.page.copyPasswordButtonState !== 'success') {
                    $timeout(function () {
                        vm.page.copyPasswordButtonState = 'success';
                    });
                    $timeout(function () {
                        resetClipboardButtonState();
                    }, 1000);
                }
            }
            // copy to clip board error
            function copyError() {
                if (vm.page.copyPasswordButtonState !== 'error') {
                    $timeout(function () {
                        vm.page.copyPasswordButtonState = 'error';
                    });
                    $timeout(function () {
                        resetClipboardButtonState();
                    }, 1000);
                }
            }
            function resetClipboardButtonState() {
                vm.page.copyPasswordButtonState = 'init';
            }
            function goToUser(userId) {
                $location.path('users/users/user/' + userId);
            }
            // helpers
            function getUsers() {
                vm.loading = true;
                // Get users
                usersResource.getPagedResults(vm.usersOptions).then(function (data) {
                    vm.users = data.items;
                    vm.usersOptions.pageNumber = data.pageNumber;
                    vm.usersOptions.pageSize = data.pageSize;
                    vm.usersOptions.totalItems = data.totalItems;
                    vm.usersOptions.totalPages = data.totalPages;
                    formatDates(vm.users);
                    setUserDisplayState(vm.users);
                    vm.userStatesFilter = usersHelper.getUserStatesFilter(data.userStates);
                    vm.loading = false;
                }, function (error) {
                    vm.loading = false;
                });
            }
            function setUserDisplayState(users) {
                angular.forEach(users, function (user) {
                    user.userDisplayState = usersHelper.getUserStateFromValue(user.userState);
                });
            }
            function formatDates(users) {
                angular.forEach(users, function (user) {
                    if (user.lastLoginDate) {
                        var dateVal;
                        var serverOffset = Umbraco.Sys.ServerVariables.application.serverTimeOffset;
                        var localOffset = new Date().getTimezoneOffset();
                        var serverTimeNeedsOffsetting = -serverOffset !== localOffset;
                        if (serverTimeNeedsOffsetting) {
                            dateVal = dateHelper.convertToLocalMomentTime(user.lastLoginDate, serverOffset);
                        } else {
                            dateVal = moment(user.lastLoginDate, 'YYYY-MM-DD HH:mm:ss');
                        }
                        // get current backoffice user and format date
                        userService.getCurrentUser().then(function (currentUser) {
                            user.formattedLastLogin = dateVal.locale(currentUser.locale).format('LLL');
                        });
                    }
                });
            }
            function setBulkActions(users) {
                // reset all states
                vm.allowDisableUser = true;
                vm.allowEnableUser = true;
                vm.allowUnlockUser = true;
                vm.allowSetUserGroup = true;
                var firstSelectedUserGroups;
                angular.forEach(users, function (user) {
                    if (!user.selected) {
                        return;
                    }
                    // if the current user is selected prevent any bulk actions with the user included
                    if (user.isCurrentUser) {
                        vm.allowDisableUser = false;
                        vm.allowEnableUser = false;
                        vm.allowUnlockUser = false;
                        vm.allowSetUserGroup = false;
                        return;
                    }
                    if (user.userDisplayState && user.userDisplayState.key === 'Disabled') {
                        vm.allowDisableUser = false;
                    }
                    if (user.userDisplayState && user.userDisplayState.key === 'Active') {
                        vm.allowEnableUser = false;
                    }
                    if (user.userDisplayState && user.userDisplayState.key === 'Invited') {
                        vm.allowEnableUser = false;
                    }
                    if (user.userDisplayState && user.userDisplayState.key === 'LockedOut') {
                        vm.allowEnableUser = false;
                    }
                    if (user.userDisplayState && user.userDisplayState.key !== 'LockedOut') {
                        vm.allowUnlockUser = false;
                    }
                    // store the user group aliases of the first selected user
                    if (!firstSelectedUserGroups) {
                        firstSelectedUserGroups = user.userGroups.map(function (ug) {
                            return ug.alias;
                        });
                        vm.allowSetUserGroup = true;
                    } else if (vm.allowSetUserGroup === true) {
                        // for 2nd+ selected user, compare the user group aliases to determine if we should allow bulk editing.
                        // we don't allow bulk editing of users not currently having the same assigned user groups, as we can't
                        // really support that in the user group picker.
                        var userGroups = user.userGroups.map(function (ug) {
                            return ug.alias;
                        });
                        if (_.difference(firstSelectedUserGroups, userGroups).length > 0) {
                            vm.allowSetUserGroup = false;
                        }
                    }
                });
            }
            function clearAddUserForm() {
                // clear form data
                vm.newUser.name = '';
                vm.newUser.email = '';
                vm.newUser.userGroups = [];
                vm.newUser.message = '';
                // clear button state
                vm.page.createButtonState = 'init';
            }
            init();
        }
        angular.module('umbraco').controller('Umbraco.Editors.Users.UsersController', UsersController);
    }());
}());