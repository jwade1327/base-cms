const querystring = require('querystring');
const { UserInputError } = require('apollo-server-express');

const cleanRedirect = async (redirect, from, basedb) => {
  // Redirect already found. Do nothing.
  if (redirect) return redirect;
  const regex = /\.html.+$/i;
  // From does not match the pattern. Do nothing.
  if (!regex.test(from)) return redirect;
  // Clean the url.
  const cleaned = from.replace(regex, '.html');
  // Try to find the redirect again.
  return basedb.findOne('website.Redirects', { from: cleaned });
};

module.exports = {
  /**
   *
   */
  WebsiteRedirect: {
    code: ({ code }) => code || 301,
  },

  Query: {
    websiteRedirect: async (_, { input }, { basedb, site }) => {
      const { from, params } = input;
      const siteId = input.siteId || site.id();
      if (!siteId) throw new UserInputError('A siteId must be provided via input or context.');

      const query = querystring.stringify(params);
      const redirect = await basedb.findOne('website.Redirects', { siteId, from });
      const cleaned = await cleanRedirect(redirect, from, basedb);
      // Preserve query string params (if applicable);
      if (cleaned && cleaned.to && query) cleaned.to = `${cleaned.to}?${query}`;
      return cleaned;
    },
  },
};
