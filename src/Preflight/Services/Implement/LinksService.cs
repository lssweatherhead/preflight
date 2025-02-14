﻿using HtmlAgilityPack;
using Preflight.Extensions;
using Preflight.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;

namespace Preflight.Services.Implement
{
    public class LinksService : ILinksService
    {
        private const string _href = "href";

        /// <summary>
        /// Return a list of broken links (href and link text)
        /// Checks internal links by node, fails relative internal links, checks external links
        /// </summary>
        /// <param name="text"></param>
        /// <param name="safeBrowsingResult"></param>
        public List<BrokenLinkModel> Check(string text, List<BrokenLinkModel> safeBrowsingResult)
        {
            List<BrokenLinkModel> response = new List<BrokenLinkModel>();

            var doc = new HtmlDocument();
            doc.LoadHtml(text);

            HtmlNodeCollection links = doc.DocumentNode.SelectNodes(KnownStrings.HrefXPath);

            if (links == null || !links.Any()) return response;

            // filter out safebrowsing results if any exist
            IEnumerable<HtmlNode> linksToCheck = links.ToList();
            if (safeBrowsingResult != null && safeBrowsingResult.Any())
            {
                linksToCheck = links.Where(l =>
                    safeBrowsingResult.All(m =>
                        m.Href != l.GetAttributeValue(_href, string.Empty)));
            }

            if (!linksToCheck.Any()) return response;

            foreach (HtmlNode link in linksToCheck)
            {
                string href = link.GetAttributeValue(_href, string.Empty);

                var responseItem = new BrokenLinkModel
                {
                    Href = href,
                    Text = link.InnerText
                };

                if (href.HasValue())
                {
                    SetResponseStatusWhenHrefExists(href, responseItem);
                }
                else
                {
                    responseItem.Status = "Href not set";
                }

                // if status is null, the link is ok
                if (responseItem.Status.HasValue())
                {
                    response.Add(responseItem);
                }
            }

            return response;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="href"></param>
        /// <param name="responseItem"></param>
        private static void SetResponseStatusWhenHrefExists(string href, BrokenLinkModel responseItem)
        {
            if (Uri.IsWellFormedUriString(href, UriKind.Relative))
            {
                responseItem.Status = "Invalid internal link";
                return;
            }

            if (Uri.IsWellFormedUriString(href, UriKind.Absolute))
            {
                var uri = new Uri(href);

                if (uri.Host == PreflightContext.HostUrl)
                {
                    responseItem.Status = "Invalid internal link";
                }
                else
                {
                    HttpStatusCode status = GetHeaders(href);

                    if (status != HttpStatusCode.OK)
                    {
                        responseItem.Status = $"Broken/unavailable ({(int)status})";
                    }
                }
            }
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="url"></param>
        /// <returns></returns>
        private static HttpStatusCode GetHeaders(string url)
        {
            HttpStatusCode result = default(HttpStatusCode);
            WebRequest request = WebRequest.Create(url);

            request.Method = WebRequestMethods.Http.Head;

            try
            {
                using (var response = request.GetResponse() as HttpWebResponse)
                {
                    if (response != null)
                    {
                        result = response.StatusCode;
                    }
                }
            }
            catch (WebException ex)
            {
                if (ex.Response is HttpWebResponse resp)
                {
                    result = resp.StatusCode;
                }
                else
                {
                    result = HttpStatusCode.NotFound;
                }
            }

            return result;
        }
    }
}
