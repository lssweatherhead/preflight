﻿using System;
using Newtonsoft.Json.Linq;
using Preflight.Constants;
using Preflight.Models;
using Preflight.Services.Interfaces;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Preflight.Extensions;
using Preflight.Plugins;
using Umbraco.Core.Models;

namespace Preflight.Services
{
    internal class ContentChecker : IContentChecker
    {
        private readonly List<string> _added;
        private readonly List<SettingsModel> _settings;

        private int _id;

        public ContentChecker(ISettingsService settingsService)
        {
            _added = new List<string>();
            _settings = settingsService.Get().Settings;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="content"></param>
        /// <returns></returns>
        public PreflightResponseModel Check(IContent content)
        {
            // make this available to pass into any plugins
            _id = content.Id;

            IEnumerable <Property> props = content.GetPreflightProperties();

            var response = new PreflightResponseModel
            {
                CancelSaveOnFail = _settings.GetValue<bool>(KnownSettings.CancelSaveOnFail)
            };

            foreach (Property prop in props)
            {
                switch (prop.PropertyType.PropertyEditorAlias)
                {
                    case KnownPropertyAlias.Grid:
                        response.Properties.AddRange(CheckNestedEditor(prop, KnownStrings.RteJsonPath));
                        break;
                    case KnownPropertyAlias.Archetype:
                        response.Properties.AddRange(CheckNestedEditor(prop, KnownStrings.ArchetypeRteJsonPath));
                        break;
                    case KnownPropertyAlias.Rte:
                        response.Properties.Add(CheckSingleEditor(prop));
                        break;
                }
            }

            response.Failed = response.Properties.Any(p => p.Failed);

            if (!response.Failed) return response;

            response.FailedCount = response.Properties.Sum(p => p.FailedCount);

            return response;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="content"></param>
        /// <returns></returns>
        public IContent Autoreplace(IContent content)
        {
            // perform autoreplace before readability check
            // only do this in save handler as there's no point in updating if it's not being saved (potentially)
            Dictionary<string, string> autoreplace = _settings.GetValue<string>(KnownSettings.AutoreplaceTerms)?.Split(',')
                .ToDictionary(
                    s => s.Split('|')[0], 
                    s => s.Split('|')[1]
                );

            if (autoreplace == null || !autoreplace.Any()) return content;

            IEnumerable<Property> props = content.GetPreflightProperties();

            foreach (Property prop in props)
            {
                foreach (KeyValuePair<string, string> term in autoreplace)
                {
                    string pattern = $@"\b{term.Key}\b";
                    prop.SetValue(Regex.Replace(prop.GetValue().ToString(), pattern, term.Value, RegexOptions.IgnoreCase));
                }
            }

            return content;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="prop"></param>
        /// <param name="editorPath"></param>
        /// <returns></returns>
        private IEnumerable<PreflightPropertyResponseModel> CheckNestedEditor(Property prop, string editorPath)
        {
            object propValue = prop.GetValue();

            if (propValue == null)
            {
                return null;
            }

            JObject asJson = JObject.Parse(propValue.ToString());
            IEnumerable<JToken> rtes = asJson.SelectTokens(editorPath);

            string name = prop.PropertyType.Name;

            List<PreflightPropertyResponseModel> response = new List<PreflightPropertyResponseModel>();

            foreach (JToken rte in rtes)
            {
                JToken value = rte.SelectToken(KnownStrings.RteValueJsonPath);
                if (value == null) continue;

                PreflightPropertyResponseModel model = CheckProperty(SetName(name), value.ToString());

                response.Add(model);
            }

            return response;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="prop"></param>
        /// <returns></returns>
        private PreflightPropertyResponseModel CheckSingleEditor(Property prop)
        {
            object propValue = prop.GetValue();
            return propValue == null ? null : CheckProperty(prop.PropertyType.Name, propValue.ToString());
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="name"></param>
        /// <param name="val"></param>
        /// <returns></returns>
        private PreflightPropertyResponseModel CheckProperty(string name, string val)
        {
            var model = new PreflightPropertyResponseModel
            {
                Name = name
            };

            var pluginProvider = new PluginProvider();

            foreach (IPreflightPlugin plugin in pluginProvider.Get())
            {
                // settings on the plugin are the defaults - set to correct values from _settings
                // needs foreach as Settings has no settor, but the individual setting values do
                IEnumerable<SettingsModel> pluginSettings = _settings.Where(s => s.Tab == plugin.Name).ToList();
               
                foreach (SettingsModel setting in plugin.Settings)
                {
                    setting.Value = pluginSettings.First(s => s.Alias == setting.Alias).Value;
                }

                // ignore disabled plugins
                if (plugin.IsDisabled())
                    continue;

                try
                {
                    Type pluginType = plugin.GetType();
                    if (pluginType.GetMethod("Check") == null) continue;

                    plugin.Check(_id, val, _settings);

                    if (plugin.Result != null)
                    {
                        if (plugin.FailedCount == 0)
                        {
                            plugin.FailedCount = plugin.Failed ? 1 : 0;
                        }
                        model.Plugins.Add(plugin);
                    }
                }
                catch (Exception e)
                {
                    // todo => log
                    string m = e.Message;
                }
            }

            // mark as failed if any sub-tests have failed
            model.FailedCount = model.Plugins.Sum(x => x.FailedCount);
            model.Failed = model.FailedCount > 0;

            model.Plugins = model.Plugins.OrderBy(p => p.SortOrder).ToList();

            return model;
        }

        /// <summary>
        /// Helper for formatting the property name in the response
        /// </summary>
        /// <param name="name">Name of the current property</param>
        /// <returns></returns>
        private string SetName(string name)
        {
            string response = _added.IndexOf(name) != -1 ? $"{name} (Editor {_added.IndexOf(name) + 2})" : name;
            _added.Add(name);

            return response;
        }
    }
}
