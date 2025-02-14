﻿using Preflight.Models;
#if NETCOREAPP
using Umbraco.Cms.Core.Models;
#else
using Umbraco.Core.Models;
#endif

namespace Preflight.Services
{
    public interface IContentChecker
    {
        bool CheckContent(int id, string culture, bool fromSave = false);
        bool CheckContent(IContent content, string culture, bool fromSave = false);

        /// <summary>
        /// Checks set of property values and returns responses via signalr broadcast
        /// </summary>
        /// <param name="dirtyProperties"></param>
        bool CheckDirty(DirtyProperties dirtyProperties);
    }
}
