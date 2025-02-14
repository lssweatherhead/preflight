﻿using Preflight.Extensions;
using Preflight.Models;
using Preflight.Plugins;
using System;
using System.Linq;
using Preflight.Services;
using System.Collections.Generic;
using Preflight.Parsers;
#if NETCOREAPP
using Microsoft.Extensions.Logging;
#else
using Preflight.Logging;
#endif

namespace Preflight.Executors
{
    public interface IPluginExecutor
    {
        PreflightPropertyResponseModel Execute(ContentParserParams parserParams, string parentAlias = "");
    }

    public class PluginExecutor : IPluginExecutor
    {
        private string _testableProperties;
        private List<SettingsModel> _settings;

        private readonly ILogger<IPreflightValueParser> _logger;
        private readonly ISettingsService _settingsService;
        private readonly PreflightPluginCollection _plugins;

        public PluginExecutor(PreflightPluginCollection plugins, ISettingsService settingsService, ILogger<IPreflightValueParser> logger)
        {
            _plugins = plugins;
            _settingsService = settingsService;
            _logger = logger;
        }

        /// <summary>
        /// Runs the set of plugins against the given string
        /// </summary>
        /// <param name="name"></param>
        /// <param name="val"></param>
        /// <returns></returns>
        public PreflightPropertyResponseModel Execute(ContentParserParams parserParams, string parentAlias = "")
        {
            _settings = _settingsService.Get().Settings;
            _testableProperties = _settings.GetValue<string>(KnownSettings.PropertiesToTest, parserParams.Culture);

            var model = new PreflightPropertyResponseModel
            {
                Label = parserParams.PropertyName,
                Name = parserParams.PropertyName,
            };

            if (parserParams.PropertyValue == null ||
                !_testableProperties.Contains(parserParams.PropertyEditorAlias) ||
                (parentAlias.HasValue() && !_testableProperties.Contains(parentAlias)))
            {
                return model;
            }

            foreach (IPreflightPlugin plugin in _plugins)
            {
                // settings on the plugin are the defaults - set to correct values from _settings
                plugin.Settings = _settings.Where(s => s.Tab == plugin.Name)?.ToList();

                // ignore disabled plugins
                if (plugin.IsDisabled(parserParams.Culture)) continue;
                if (!parserParams.FromSave && plugin.IsOnSaveOnly(parserParams.Culture)) continue;

                string propsValue = plugin.Settings.FirstOrDefault(x => x.Alias.EndsWith(KnownStrings.PropertiesToTestSuffix))?.Value.ForVariant(parserParams.Culture);
                string propsToTest = propsValue ?? string.Join(KnownStrings.Comma, KnownPropertyAlias.All);

                // only continue if the field alias is include for testing, or the parent alias has been set, and is included for testing
                if (!propsToTest.Contains(parserParams.PropertyEditorAlias) || (parentAlias.HasValue() && !propsToTest.Contains(parentAlias))) continue;

                try
                {
                    Type pluginType = plugin.GetType();
                    if (pluginType.GetMethod("Check") == null) continue;

                    plugin.Result = null;
                    plugin.Check(parserParams.NodeId, parserParams.Culture, parserParams.PropertyValue, _settings);

                    if (plugin.Result != null)
                    {
                        // must be a new object, otherwise returns the plugin instance from the collection
                        var resultModel = new PreflightPluginResponseModel(plugin);
                        model.Plugins.Add(resultModel);
                    }
                }
                catch (Exception e)
                {
                    _logger.LogError(e, "Preflight couldn't take off: {Message}", e.Message);
                }
            }

            // mark as failed if any sub-tests have failed
            model.FailedCount = model.Plugins.Sum(x => x.FailedCount);
            model.Failed = model.FailedCount > 0;

            model.Plugins = model.Plugins.OrderBy(p => p.SortOrder).ToList();
            model.TotalTests = model.Plugins.Aggregate(0, (acc, x) => acc + x.TotalTests);

            return model;
        }
    }
}
