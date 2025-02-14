﻿using Preflight.Models;
using System.Collections.Generic;

namespace Preflight.Services
{
    public interface ILinksService
    {
        List<BrokenLinkModel> Check(string text, List<BrokenLinkModel> safeBrowsingResult);
    }
}
