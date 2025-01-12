const { BaseDB } = require('@parameter1/base-cms-db');
const { UserInputError } = require('apollo-server-express');
const { Base4RestPayload } = require('@parameter1/base-cms-base4-rest-api');
const { cleanPath, asObject } = require('@parameter1/base-cms-utils');
const { content: canonicalPathFor } = require('@parameter1/base-cms-canonical-path');
const { get, getAsObject } = require('@parameter1/base-cms-object-path');
const { underscore, dasherize, titleize } = require('@parameter1/base-cms-inflector');
const { createSrcFor, createCaptionFor } = require('@parameter1/base-cms-image');
const { getAsArray } = require('@parameter1/base-cms-object-path');
const moment = require('moment');
const momentTZ = require('moment-timezone');
const cheerio = require('cheerio');

const defaults = require('../../defaults');
const validateRest = require('../../utils/validate-rest');
const mapArray = require('../../utils/map-array');
const sitemap = require('../../utils/sitemap');
const criteriaFor = require('../../utils/criteria-for');
const buildProjection = require('../../utils/build-projection');
const getProjection = require('../../utils/get-projection');
const formatStatus = require('../../utils/format-status');
const getEmbeddedImageTags = require('../../utils/embedded-image-tags');
const getEmbeddedDocumentTags = require('../../utils/embedded-document-tags');
const relatedContent = require('../../utils/related-content');
const inquiryEmails = require('../../utils/inquiry-emails');
const connectionProjection = require('../../utils/connection-projection');
const getDescendantIds = require('../../utils/website-section-child-ids');
const {
  createTitle,
  createDescription,
  getPublishedCriteria,
  getDefaultContentTypes,
} = require('../../utils/content');
const contentTeaser = require('../../utils/content-teaser');
const googleDataApiClient = require('../../../google-data-api-client');
const SiteContext = require('../../../site-context');

const retrieveYoutubePlaylistId = async ({ youtube }) => {
  const playlistId = get(youtube, 'playlistId');
  if (playlistId) return playlistId;

  const id = get(youtube, 'channelId');
  const forUsername = get(youtube, 'username');
  if (!id && !forUsername) return null;
  const payload = { part: 'contentDetails' };
  if (id) {
    payload.id = id;
  } else {
    payload.forUsername = forUsername;
  }
  const response = await googleDataApiClient.request('youtube.channelList', payload);
  return get(response, 'items.0.contentDetails.relatedPlaylists.uploads');
};

const { isArray } = Array;

const resolveType = async ({ type }) => `Content${type}`;

const loadSection = async ({
  basedb,
  siteId,
  id,
  alias,
}) => {
  if (!id && !alias) return null;
  const sectionQuery = {
    status: 1,
    ...(siteId && { 'site.$id': siteId }),
  };
  if (alias) {
    sectionQuery.alias = alias;
  } else {
    sectionQuery._id = id;
  }
  return basedb.strictFindOne('website.Section', sectionQuery, { projection: { _id: 1 } });
};

const loadOptions = async ({
  basedb,
  siteId,
  ids = [],
  names = [],
}) => {
  if (!ids.length && !names.length) return [];
  const optionQuery = {
    status: 1,
    ...(siteId && { 'site.$id': siteId }),
  };
  if (ids.length) {
    optionQuery._id = { $in: ids };
  } else {
    optionQuery.name = { $in: names };
  }
  return basedb.find('website.Option', optionQuery, { projection: { _id: 1 } });
};

const loadMagazineSections = async ({
  basedb,
  ids = [],
  names = [],
}) => {
  if (!ids.length && !names.length) return [];
  const sectionQuery = {
    status: 1,
  };
  if (ids.length) {
    sectionQuery._id = { $in: ids };
  } else {
    sectionQuery.name = { $in: names };
  }
  return basedb.find('magazine.Section', sectionQuery, { projection: { _id: 1 } });
};

const loadHomeSection = async ({
  basedb,
  siteId,
  status,
  projection,
}) => basedb.findOne('website.Section', {
  alias: 'home',
  ...formatStatus(status),
  ...(siteId && { 'site.$id': siteId }),
}, { projection });

const formatContentType = ({ type }, { input }) => {
  const { format } = input;
  switch (format) {
    case 'dasherize':
      return dasherize(type);
    case 'underscore':
      return underscore(type);
    case 'titleize':
      return titleize(type);
    default:
      return type;
  }
};

const createSitemapLoc = async (content, ctx) => {
  const { site } = ctx;
  if (!site.exists()) throw new UserInputError('A website context must be set to generate sitemap `loc` fields.');
  const path = await canonicalPathFor(content, ctx);
  return encodeURI(sitemap.escape(`${site.get('origin')}${path}`));
};

const loadSitemapImages = ({ content, basedb }) => {
  const { images } = content;
  if (!isArray(images) || !images.length) return [];
  const query = { ...criteriaFor('assetImage'), _id: { $in: images } };
  const projection = {
    name: 1,
    caption: 1,
    filePath: 1,
    fileName: 1,
    cropDimensions: 1,
  };
  return basedb.find('platform.Asset', query, { projection });
};

const updateContentMutationHandler = ({
  allowedContentTypes = [],
  buildPayload = (input) => {
    const { id, ...payload } = input;
    return Object.keys(payload).reduce((obj, key) => ({ ...obj, [key]: payload[key] }), {});
  },
} = {}) => async (_, { input }, { basedb, base4rest }, info) => {
  validateRest(base4rest);
  const { id } = input;
  const doc = await basedb.strictFindById('platform.Content', id, { projection: { type: 1 } });
  if (allowedContentTypes.length && !allowedContentTypes.includes(doc.type)) {
    throw new UserInputError(`This operation only supports the following content types: ${allowedContentTypes.join(', ')}`);
  }
  const type = `platform/content/${dasherize(doc.type)}`;
  const body = new Base4RestPayload({ type });
  const payload = buildPayload(input);
  Object.keys(payload).forEach(k => body.set(k, payload[k]));
  body.set('id', id);
  await base4rest.updateOne({ model: type, id, body });
  const projection = buildProjection({ info, type: `Content${doc.type}` });
  return basedb.findById('platform.Content', id, { projection: { ...projection, type: 1 } });
};

module.exports = {
  /**
   *
   */
  Addressable: {
    __resolveType: resolveType,
    cityStateZip: ({ city, state, zip }) => {
      let out = '';
      if (city && state) {
        out = `${city}, ${state}`;
      } else if (city) {
        out = `${city}`;
      } else if (state) {
        out = `${state}`;
      }
      if (zip) out = `${out} ${zip}`;
      return out || null;
    },
  },

  /**
   *
   */
  Authorable: { __resolveType: resolveType },

  /**
   *
   */
  Contactable: {
    __resolveType: resolveType,
    website: ({ website }) => {
      if (!website) return website;
      return /^http/.test(website) ? website : `https://${website}`;
    },
  },

  /**
   *
   */
  SocialLinkable: { __resolveType: resolveType },

  /**
   *
   */
  OrganizationContactable: { __resolveType: resolveType },

  /**
   *
   */
  PrimaryCategory: { __resolveType: resolveType },

  /**
   *
   */
  Inquirable: {
    __resolveType: resolveType,
    inquiryEmails,
  },

  /**
   *
   */
  Media: {
    __resolveType: resolveType,
    fileSrc: ({ fileName, filePath }, _, { site }) => {
      if (!fileName || !filePath) return null;
      const assetHost = site.get('assetHost', defaults.assetHost);
      return `https://${assetHost}/${cleanPath(filePath)}/${fileName}`;
    },
  },

  /**
   *
   */
  ContentMetadata: {
    title: (content, _, ctx) => createTitle(content, ctx),
    description: content => createDescription(content),
  },

  /**
   *
   */
  Content: {
    __resolveType: resolveType,

    externalLinks: (content, { input }) => {
      const keys = getAsArray(input, 'keys');
      const links = getAsArray(content, 'externalLinks');
      if (keys.length) return links.filter(({ key }) => keys.includes(key));
      return links;
    },

    siteContext: async (content, { input }, ctx) => {
      const { enableLinkUrl } = input;
      const { site, load, basedb } = ctx;
      if (!site.exists()) throw new UserInputError('A website context must be set to generate `Content.siteContext` fields.');

      return {
        path: () => canonicalPathFor(content, ctx, { enableLinkUrl }),
        url: async () => {
          const path = await canonicalPathFor(content, ctx, { enableLinkUrl });
          if (/^http/i.test(path)) return path;
          return `${site.get('origin')}${path}`;
        },
        canonicalUrl: async () => {
          const canonicalUrl = get(content, 'mutations.Website.canonicalUrl');
          // Return the canonical URL when explicitally set on content.
          if (canonicalUrl) return canonicalUrl;

          const primarySectionRef = BaseDB.get(content, 'mutations.Website.primarySection');
          const primarySectionId = BaseDB.extractRefId(primarySectionRef);
          const sectionProjection = { alias: 1, 'site.$id': 1 };

          const primarySection = primarySectionId
            ? await load('websiteSection', primarySectionId, sectionProjection, { status: 1 })
            : await loadHomeSection({
              basedb,
              siteId: site.id(),
              status: 'active',
              projection: sectionProjection,
            });

          const owningSiteId = primarySection
            ? BaseDB.extractRefId(primarySection.site)
            : site.id();

          const owningSite = `${owningSiteId}` === `${site.id()}`
            ? site.obj()
            : await load('platformProduct', owningSiteId, { host: 1 }, { type: 'Site' });

          const canonicalPath = await canonicalPathFor(content, {
            ...ctx,
            site: new SiteContext(owningSite),
          }, { enableLinkUrl });


          const origin = `https://${owningSite.host}`;
          return `${origin}/${cleanPath(canonicalPath)}`;
        },
        noIndex: () => Boolean(get(content, 'mutations.Website.noIndex')),
      };
    },

    /**
     * @deprecated use `siteContext.canonicalUrl` instead
     */
    canonicalUrl: async (content, _, ctx) => {
      const { load, basedb, site } = ctx;
      if (!site.exists()) throw new UserInputError('A website context must be set to generate the `Content.canonicalUrl` field.');

      const path = await canonicalPathFor(content, ctx);

      const projection = { alias: 1, 'site.$id': 1 };

      const ref = BaseDB.get(content, 'mutations.Website.primarySection');
      const id = BaseDB.extractRefId(ref);
      const section = (id) ? await load('websiteSection', id, projection, { status: 1 }) : await loadHomeSection({
        basedb,
        siteId: site.id(),
        status: 'active',
        projection,
      });

      const owningSiteId = section ? BaseDB.extractRefId(section.site) : site.id();
      const owningSite = `${owningSiteId}` === `${site.id()}` ? site.obj() : await load('platformProduct', owningSiteId, { host: 1 }, { type: 'Site' });
      const origin = `https://${owningSite.host}`;
      return `${origin}/${cleanPath(path)}`;
    },

    /**
     * @deprecated use `siteContext.url` instead
     */
    websiteUrl: async (content, _, ctx) => {
      const { site } = ctx;
      if (!site.exists()) throw new UserInputError('A website context must be set to generate the `Content.websiteUrl` field.');
      const path = await canonicalPathFor(content, ctx);
      if (/^http/i.test(path)) return path;
      return `${site.get('origin')}${path}`;
    },

    /**
     * Load primary section of content.
     * If primary section's site matches the current site, return the section.
     * If not, check for alternative site + section (@todo).
     * Return alternate section (if found), otherwise return home section of current site.
     * If no site is provided, simply return the current section.
     */
    primarySection: async (content, { input }, { load, site, basedb }, info) => {
      const { status } = input;
      const {
        returnType,
        fieldNodes,
        schema,
        fragments,
      } = info;
      const projection = getProjection(schema, returnType, fieldNodes[0].selectionSet, fragments);

      const siteId = input.siteId || site.id();
      const ref = BaseDB.get(content, 'mutations.Website.primarySection');
      const id = BaseDB.extractRefId(ref);
      if (!id) {
        // No primary section reference found. Load home section for current site.
        return loadHomeSection({
          basedb,
          siteId,
          status,
          projection,
        });
      }

      const query = {
        ...formatStatus(status),
        ...(siteId && { 'site.$id': siteId }),
      };
      const section = await load('websiteSection', id, projection, query);
      if (section) return section;

      // Current section does not match site, load alternate.
      // @todo This should eventually account for secondary sites/sections. For now, load home.
      // @todo Should this value be "pure" - meaning, do not override value and simply return?
      return loadHomeSection({
        basedb,
        siteId,
        status,
        projection,
      });
    },

    shortName: (content) => {
      const shortName = get(content, 'shortName', '').trim();
      const mutatedName = get(content, 'mutations.Website.name', '').trim();
      if (shortName) return shortName;
      if (mutatedName) return mutatedName;
      return content.name;
    },

    teaser: (content, { input }) => {
      const { mutation } = input;
      const teaser = contentTeaser.getTeaser(mutation, content);
      const { teaserFallback } = content;
      return contentTeaser.generateTeaser(teaser, teaserFallback, input) || null;
    },

    taxonomyIds: content => getAsArray(content, 'taxonomy').map(t => parseInt(t.oid, 10)).filter(id => id),

    body: async (content, { input }, { site, basedb }) => {
      const { mutation } = input;
      const { body } = content;
      const mutated = get(content, `mutations.${mutation}.body`);

      let value = mutation ? mutated || body : body;
      // Use site image host otherwise fallback to global default.
      const imageHost = site.get('imageHost', defaults.imageHost);
      // Convert image tags to include image attributes (src, alt, caption, credit).
      // Convert document tags to include href and file extension.
      const [imageTags, documentTags] = await Promise.all([
        getEmbeddedImageTags(value, { imageHost, basedb }),
        getEmbeddedDocumentTags(value, { imageHost, basedb }),
      ]);

      imageTags.forEach((tag) => {
        const replacement = tag.isValid() ? tag.build() : '';
        value = value.replace(tag.getRegExp(), replacement);
      });

      documentTags.forEach((tag) => {
        const replacement = tag.isValid() ? tag.build() : '';
        value = value.replace(tag.getRegExp(), replacement);
      });
      return value;
    },

    userRegistration: (content) => {
      const requiresRegistration = get(content, 'mutations.Website.requiresRegistration');
      const requiresAccessLevels = get(content, 'mutations.Website.requiresAccessLevels');

      const userRegistration = {
        isRequired: Boolean(requiresRegistration),
        accessLevels: [],
      };

      if (!requiresRegistration) return userRegistration;
      if (isArray(requiresAccessLevels)) userRegistration.accessLevels = requiresAccessLevels;
      return userRegistration;
    },

    metadata: content => content,

    customAttribute: (content, { input }) => {
      const { path } = input;
      if (!path) return null;
      const value = get(content, `customAttributes.${path}`);
      if (!value) return null;
      return `${value}`;
    },

    /**
     * @deprecated use `siteContext.url` instead
     */
    canonicalPath: (content, _, ctx) => {
      const { site } = ctx;
      if (!site.exists()) throw new UserInputError('A website context must be set to generate the `Content.canonicalPath` field.');
      return canonicalPathFor(content, ctx);
    },

    /**
     * @deprecated use `siteContext.url` instead
     */
    websitePath: (content, _, ctx) => {
      const { site } = ctx;
      if (!site.exists()) throw new UserInputError('A website context must be set to generate the `Content.websitePath` field.');
      return canonicalPathFor(content, ctx);
    },

    redirectTo: (content) => {
      const { type, linkUrl } = content;
      const redirectTo = get(content, 'mutations.Website.redirectTo');
      if (redirectTo) return redirectTo;

      const types = ['Promotion', 'TextAd'];
      if (!types.includes(type)) return null;

      return linkUrl;
    },

    type: formatContentType,

    statusText: ({ status, published, unpublished }) => {
      const now = Date.now();
      switch (status) {
        case 0:
          return 'Deleted';
        case 1:
          if (published && published.valueOf() > now) return 'Scheduled';
          if (unpublished && unpublished < now) return 'Expired';
          if (published) return 'Published';
          return 'Unpublished';
        case 2:
          return 'Draft';
        default:
          return 'Unpublished';
      }
    },

    relatedContent: (doc, { input }, { basedb, site }, info) => {
      const {
        queryTypes,
        withSite,
      } = input;
      // If no query types were specified (owned, inverse, etc), return an empty response.
      if (!queryTypes.length) return BaseDB.paginateEmpty();

      // Run perform the related content query.
      return relatedContent.performQuery(doc, {
        ...(withSite && { siteId: input.siteId || site.id() }),
        input,
        basedb,
        info,
      });
    },

    /**
     *
     */
    hasWebsiteSchedule: async (doc, { input }, { basedb, site }) => {
      const {
        sectionId,
        sectionAlias,
        optionId,
        optionName,
        sectionBubbling,
      } = input;

      if (!sectionId && !sectionAlias) throw new UserInputError('Either a sectionId or sectionAlias input must be provided.');
      if (sectionId && sectionAlias) throw new UserInputError('You cannot provide both sectionId and sectionAlias as input.');
      if (optionId.length && optionName.length) throw new UserInputError('You cannot provide both optionId and optionName as input.');

      const siteId = input.siteId || site.id();
      const [section, options] = await Promise.all([
        loadSection({
          basedb,
          siteId,
          id: sectionId,
          alias: sectionAlias,
        }),
        loadOptions({
          basedb,
          siteId,
          ids: optionId,
          names: optionName.length ? optionName : ['Standard'],
        }),
      ]);

      const descendantIds = sectionBubbling ? await getDescendantIds(section._id, basedb) : [];

      const now = new Date();
      const $elemMatch = {
        sectionId: descendantIds.length ? { $in: descendantIds } : section._id,
        optionId: { $in: options.map(opt => opt._id) },
        start: { $lte: now },
        $and: [
          {
            $or: [
              { end: { $gt: now } },
              { end: { $exists: false } },
            ],
          },
        ],
      };

      const query = { _id: doc._id, sectionQuery: { $elemMatch } };
      const matched = await basedb.findOne('platform.Content', query, { projection: { _id: 1 } });
      return Boolean(matched);
    },
  },

  /**
   *
   */
  ContentArticle: {
    sidebars: ({ sidebars }) => {
      if (!isArray(sidebars)) return [];
      return sidebars.map(({ body } = {}) => body).filter(v => v);
    },
  },

  /**
   *
   */
  ContentCompany: {
    youtube: ({ youtube = {} }) => youtube,
    youtubeVideos: async (content, { input }, { basedb }) => {
      const maxResults = get(input, 'pagination.limit', 10);
      const pageToken = get(input, 'pagination.after');
      const playlistId = await retrieveYoutubePlaylistId(content, basedb);
      if (!playlistId) return { pageInfo: {}, items: [] };
      const payload = {
        playlistId,
        maxResults,
        ...(pageToken && { pageToken }),
      };
      return googleDataApiClient.request('youtube.playlistItems', payload);
    },
  },

  /**
   *
   */
  ContentVideo: {
    embedSrc: ({ embedCode }) => {
      if (!embedCode) return null;
      const $ = cheerio.load(`${embedCode}`);

      const loadFromIframe = () => {
        const $iframe = $('iframe:first-of-type');
        if (!$iframe) return null;
        return $iframe.attr('src') || null;
      };

      const loadFromBrightcove = () => {
        const $video = $('video:first-of-type');
        if (!$video) return null;
        const data = $video.data();
        if (!data) return null;
        if (!['videoId', 'account', 'player', 'embed'].every(key => data[key])) return null;
        return `https://players.brightcove.net/${data.account}/${data.player}_${data.embed}/index.html?videoId=${data.videoId}`;
      };

      const iframeSrc = loadFromIframe();
      if (iframeSrc) return iframeSrc;

      const brightcoveSrc = loadFromBrightcove();
      if (brightcoveSrc) return brightcoveSrc;

      return null;
    },
  },

  ContentCompanyYoutube: {
    videos: ({ videos = [] } = {}) => videos.filter(v => v),
    url: (youtube) => {
      const { playlistId, channelId, username } = asObject(youtube);
      switch (true) {
        case Boolean(playlistId):
          return `https://youtube.com/playlist?list=${playlistId}`;
        case Boolean(channelId):
          return `https://youtube.com/channel/${channelId}`;
        case Boolean(username):
          return `https://youtube.com/user/${username}`;
        default:
          return null;
      }
    },
  },

  /**
   *
   */
  PublishedContentCount: {
    type: formatContentType,
  },

  /**
   *
   */
  ContentSitemapUrl: {
    loc: (content, _, ctx) => createSitemapLoc(content, ctx),
    images: (content, _, { basedb }) => loadSitemapImages({ content, basedb }),
  },

  /**
   *
   */
  ContentSitemapNewsUrl: {
    loc: (content, _, ctx) => createSitemapLoc(content, ctx),
    title: content => BaseDB.fillMutation(content, 'Website', 'name'),
    publication: (content, _, { site }) => {
      if (!site.exists()) throw new UserInputError('A website context must be set to generate the `ContentSitemapNewsUrl.publication` field.');
      return site.obj();
    },
    images: (content, _, { basedb }) => loadSitemapImages({ content, basedb }),
  },

  /**
   *
   */
  ContentSitemapNewsPublication: {
    name: ({ name, googleNewsPublicationName }) => googleNewsPublicationName || name,
  },

  ContentSitemapImage: {
    loc: (image, _, { site }) => {
      // Use site image host otherwise fallback to global default.
      const imageHost = site.get('imageHost', defaults.imageHost);
      return encodeURI(sitemap.escape(createSrcFor(imageHost, image, {})));
    },
    caption: image => sitemap.escape(createCaptionFor(image.caption)),
    title: image => sitemap.escape(image.name),
  },

  /**
   *
   */
  Query: {
    /**
     *
     */
    allPublishedContent: async (_, { input }, { basedb, site }, info) => {
      const {
        since,
        after,
        sectionId,
        contentTypes: deprecatedContentTypes,
        includeContentTypes,
        excludeContentTypes,
        excludeContentIds,
        includeTaxonomyIds,
        includeLabels,
        requiresImage,
        sectionBubbling,
        sort,
        pagination,
        beginning,
        ending,
        withSite,
      } = input;

      // @deprecated Prefer includeContentTypes over contentTypes.
      const contentTypes = includeContentTypes.length
        ? includeContentTypes : deprecatedContentTypes;
      const query = getPublishedCriteria({
        since,
        after,
        contentTypes,
        excludeContentIds,
        excludeContentTypes,
      });

      const siteId = input.siteId || site.id();
      if (withSite && siteId) query['mutations.Website.primarySite'] = siteId;

      if (beginning.before) query.$and.push({ startDate: { $lte: beginning.before } });
      if (beginning.after) query.$and.push({ startDate: { $gte: beginning.after } });
      if (ending.before) query.$and.push({ endDate: { $lte: ending.before } });
      if (ending.after) query.$and.push({ endDate: { $gte: ending.after } });

      if (requiresImage) {
        query.primaryImage = { $exists: true };
      }

      let sectionIds = sectionId;
      if (sectionId && sectionBubbling) {
        const descendantIds = await getDescendantIds(sectionId, basedb);
        if (descendantIds.length) {
          sectionIds = { $in: descendantIds };
        }
      }
      if (sectionIds) {
        query['mutations.Website.primarySection.$id'] = sectionIds;
      }
      if (includeTaxonomyIds.length) {
        query['taxonomy.$id'] = { $in: includeTaxonomyIds };
      }
      if (includeLabels.length) {
        query.labels = { $in: includeLabels };
      }

      const projection = connectionProjection(info);
      return basedb.paginate('platform.Content', {
        query,
        sort,
        projection,
        ...pagination,
      });
    },

    /**
     *
     */
    allPublishedContentDates: async (_, { input }, { basedb, site }) => {
      const {
        after,
        before,
        withSite,
        format,
      } = input;

      const siteId = input.siteId || site.id();

      const pipeline = [
        {
          $match: {
            ...(withSite && siteId && { siteId }),
            ...((before || after) && {
              date: {
                ...(before && { $lte: before }),
                ...(after && { $gte: after }),
              },
            }),
          },
        },
        {
          $group: {
            _id: {
              year: '$year',
              ...((format === 'months' || format === 'days') && {
                month: '$month',
              }),
              ...(format === 'days' && {
                day: '$day',
              }),
            },
            count: { $sum: '$count' },
          },
        },
        {
          $project: {
            year: '$_id.year',
            month: '$_id.month',
            day: '$_id.day',
            count: 1,
          },
        },
        {
          $sort: {
            year: 1,
            month: 1,
            day: 1,
          },
        },
      ];
      const cursor = await basedb.aggregate('platform.content-published-dates', pipeline);
      const results = await cursor.toArray();
      return results.map((r) => {
        const id = [r.year, r.month, r.day].filter(v => v).join('-');
        return { ...r, id };
      });
    },

    /**
     *
     */
    publishedContentCounts: async (_, { input }, { basedb, site }) => {
      const {
        since,
        after,
        includeContentTypes: contentTypes,
        excludeContentTypes,
      } = input;

      const $match = getPublishedCriteria({
        since,
        after,
        contentTypes,
        excludeContentTypes,
      });
      const siteId = input.siteId || site.id();
      if (siteId) $match['mutations.Website.primarySite'] = siteId;

      const pipeline = [
        { $match },
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $project: { type: '$_id', count: 1 } },
      ];
      const results = await basedb.aggregate('platform.Content', pipeline);
      return results.toArray();
    },

    contentSitemapUrls: async (_, { input }, { basedb, site }) => {
      const {
        since,
        contentTypes,
        changefreq,
        priority,
        pagination,
      } = input;

      const query = getPublishedCriteria({ since, contentTypes, excludeContentTypes: ['Promotion', 'TextAd'] });

      const siteId = input.siteId || site.id();
      if (siteId) query['mutations.Website.primarySite'] = siteId;

      const projection = {
        type: 1,
        'mutations.Website.slug': 1,
        'mutations.Website.primarySection': 1,
        updated: 1,
        images: 1,
      };
      const sort = { updated: -1 };
      const { limit, skip } = pagination;
      const cursor = await basedb.findCursor('platform.Content', query, {
        limit,
        skip,
        projection,
        sort,
      });
      const docs = [];
      await cursor.forEach((doc) => {
        docs.push({ ...doc, changefreq, priority });
      });
      return docs;
    },

    contentSitemapNewsUrls: async (_, { input }, { basedb, site }) => {
      const {
        includeContentTypes,
        excludeContentTypes,
        days,
        taxonomyIds,
        includeLabels,
        excludeLabels,
      } = input;
      const query = getPublishedCriteria({
        contentTypes: includeContentTypes,
        excludeContentTypes,
      });

      query.$and.push({ published: { $gte: moment().subtract(days, 'days').toDate() } });
      if (taxonomyIds.length) query['taxonomy.$id'] = { $in: taxonomyIds };

      if (includeLabels.length && excludeLabels.length) {
        query.labels = { $in: includeLabels, $nin: excludeLabels };
      } else {
        if (includeLabels.length) query.labels = { $in: includeLabels };
        if (excludeLabels.length) query.labels = { $nin: excludeLabels };
      }

      const siteId = input.siteId || site.id();
      if (siteId) query['mutations.Website.primarySite'] = siteId;

      const limit = 1000;
      const sort = { published: -1 };
      const projection = {
        type: 1,
        'mutations.Website.name': 1,
        'mutations.Website.slug': 1,
        'mutations.Website.primarySection': 1,
        published: 1,
        name: 1,
        images: 1,
      };
      return basedb.find('platform.Content', query, { limit, sort, projection });
    },

    /**
     *
     */
    allAuthorContent: async (_, { input }, { basedb, site }, info) => {
      const {
        since,
        contactId,
        authorTypes,
        includeContentTypes,
        requiresImage,
        sort,
        pagination,
        withSite,
      } = input;

      if (!authorTypes.length) throw new UserInputError('At least one `authorType` must be provided.');

      const query = getPublishedCriteria({ since, contentTypes: includeContentTypes });

      const siteId = input.siteId || site.id();
      if (withSite && siteId) query['mutations.Website.primarySite'] = siteId;

      query.$or = authorTypes.map((type) => {
        const field = `${type}s`;
        return { [field]: contactId };
      });

      if (requiresImage) {
        query.primaryImage = { $exists: true };
      }
      const projection = connectionProjection(info);
      return basedb.paginate('platform.Content', {
        query,
        sort,
        projection,
        ...pagination,
      });
    },

    /**
     *
     */
    allCompanyContent: async (_, { input }, { basedb, site }, info) => {
      const {
        since,
        companyId,
        includeContentTypes,
        excludeContentTypes,
        requiresImage,
        sort,
        pagination,
        withSite,
      } = input;

      const query = getPublishedCriteria({
        since,
        contentTypes: includeContentTypes,
        excludeContentTypes,
      });
      const siteId = input.siteId || site.id();
      if (withSite && siteId) query['mutations.Website.primarySite'] = siteId;

      query.$or = [
        { company: companyId },
        { 'relatedTo.$id': companyId },
      ];

      if (requiresImage) {
        query.primaryImage = { $exists: true };
      }
      const projection = connectionProjection(info);
      return basedb.paginate('platform.Content', {
        query,
        sort,
        projection,
        ...pagination,
      });
    },

    /**
     * @todo add content publishing fields to magaazine schedules
     */
    magazineScheduledContent: async (_, { input }, { basedb }, info) => {
      const {
        issueId,
        sectionId,
        excludeContentIds,
        includeContentTypes: contentTypes,
        includeSectionNames,
        excludeSectionNames,
        requiresImage,
        pagination,
      } = input;

      const since = new Date();
      const idQuery = { issue: issueId };
      if (sectionId || includeSectionNames.length || excludeSectionNames.length) {
        const [include, exclude] = await Promise.all([
          includeSectionNames.length
            ? loadMagazineSections({ basedb, names: includeSectionNames })
            : [],
          excludeSectionNames.length
            ? loadMagazineSections({ basedb, names: excludeSectionNames })
            : [],
        ]);
        idQuery.section = {
          ...(sectionId && { $eq: sectionId }),
          ...(include.length && { $in: include.map(section => section._id) }),
          ...(exclude.length && { $nin: exclude.map(section => section._id) }),
        };
      }
      const ids = await basedb.distinct('magazine.Schedule', 'content.$id', idQuery);

      const query = getPublishedCriteria({ excludeContentIds, contentTypes, since });
      query.$and.push({ _id: { $in: ids } });

      if (requiresImage) query.primaryImage = { $exists: true };

      const projection = connectionProjection(info);
      return basedb.paginate('platform.Content', {
        query,
        projection,
        sort: { field: 'published', order: 'desc' },
        ...pagination,
      });
    },

    /**
     * Retrieves expiring (or expired) website scheduled content.
     *
     * Date range examples (a before or after _must_ be provided):
     *
     * - Expiring/expired between Aug 1 and Aug 31: `before: Aug 31` and `after: Aug 1`
     * - Expiring/expired after Aug 31: `after: Aug 31`
     * - Expiring/expire before Aug 1: `before: Aug 1`
     *
     */
    websiteExpiringContent: async (_, { input }, { basedb, site }, info) => {
      const {
        before,
        after,
        sectionId,
        optionId,
        excludeContentIds,
        excludeSectionIds,
        includeContentTypes,
        excludeContentTypes,
        pagination,
      } = input;

      if (!sectionId && !optionId.length) throw new UserInputError('Either a sectionId or optionId input must be provided.');
      if (!before && !after) throw new UserInputError('Either a before or an after input must be provided.');

      const siteId = input.siteId || site.id();
      const [section, options] = await Promise.all([
        loadSection({
          basedb,
          siteId,
          id: sectionId,
        }),
        loadOptions({
          basedb,
          siteId,
          ids: optionId,
          names: ['Standard'],
        }),
      ]);

      const $elemMatch = {
        ...(optionId.length && { optionId: { $in: options.map(opt => opt._id) } }),
        $and: [],
      };
      if (before) $elemMatch.$and.push({ end: { $lte: before } });
      if (after) $elemMatch.$and.push({ end: { $gte: after } });
      if (section) $elemMatch.sectionId = section._id;
      if (excludeSectionIds.length) {
        $elemMatch.$and.push({ sectionId: { $nin: excludeSectionIds } });
      }

      const query = { sectionQuery: { $elemMatch } };

      if (includeContentTypes.length) {
        if (!isArray(query.$and)) query.$and = [];
        query.$and.push({ type: { $in: includeContentTypes } });
      } else {
        if (!isArray(query.$and)) query.$and = [];
        query.$and.push({ type: { $in: getDefaultContentTypes() } });
      }
      if (excludeContentTypes.length) {
        if (!isArray(query.$and)) query.$and = [];
        query.$and.push({ type: { $nin: excludeContentTypes } });
      }
      if (excludeContentIds.length) {
        query._id = { $nin: excludeContentIds };
      }

      const projection = connectionProjection(info);
      return basedb.paginate('platform.Content', {
        query,
        sort: { field: 'sectionQuery.0.end', order: 'desc' },
        projection: { 'sectionQuery.$.end': 1, ...projection },
        excludeProjection: ['sectionQuery.end'],
        ...pagination,
      });
    },

    /**
     *
     */
    websiteScheduledContent: async (_, { input }, { basedb, site }, info) => {
      const {
        sectionId,
        sectionAlias,
        optionId,
        optionName,
        excludeContentIds,
        excludeSectionIds,
        includeContentTypes,
        excludeContentTypes,
        requiresImage,
        sectionBubbling,
        pagination,
        since,
        after,
        beginning,
        ending,
      } = input;

      if (sectionId && sectionAlias) throw new UserInputError('You cannot provide both sectionId and sectionAlias as input.');
      if (optionId.length && optionName.length) throw new UserInputError('You cannot provide both optionId and optionName as input.');

      const hasSectionInput = Boolean(sectionId || sectionAlias);

      const siteId = input.siteId || site.id();
      const [section, options] = await Promise.all([
        loadSection({
          basedb,
          siteId,
          id: sectionId,
          alias: sectionAlias,
        }),
        loadOptions({
          basedb,
          siteId,
          ids: optionId,
          names: optionName.length ? optionName : ['Standard'],
        }),
      ]);

      const descendantIds = sectionBubbling && section
        ? await getDescendantIds(section._id, basedb) : [];

      let sectionFilter = { $exists: true };
      if (hasSectionInput) {
        sectionFilter = descendantIds.length ? { $in: descendantIds } : section._id;
      }

      const now = since || new Date();
      const $elemMatch = {
        sectionId: sectionFilter,
        optionId: { $in: options.map(opt => opt._id) },
        start: {
          $lte: now,
          ...(after && { $gte: after }),
        },
        $and: [
          {
            $or: [
              { end: { $gt: now } },
              { end: { $exists: false } },
            ],
          },
        ],
      };

      if (excludeSectionIds.length) {
        $elemMatch.$and.push({ sectionId: { $nin: excludeSectionIds } });
      }
      const query = { sectionQuery: { $elemMatch } };
      if (requiresImage) {
        query.primaryImage = { $exists: true };
      }
      if (includeContentTypes.length) {
        if (!isArray(query.$and)) query.$and = [];
        query.$and.push({ type: { $in: includeContentTypes } });
      } else {
        if (!isArray(query.$and)) query.$and = [];
        query.$and.push({ type: { $in: getDefaultContentTypes() } });
      }
      if (excludeContentTypes.length) {
        if (!isArray(query.$and)) query.$and = [];
        query.$and.push({ type: { $nin: excludeContentTypes } });
      }
      if (excludeContentIds.length) {
        query._id = { $nin: excludeContentIds };
      }

      if (beginning.before) query.$and.push({ startDate: { $lte: beginning.before } });
      if (beginning.after) query.$and.push({ startDate: { $gte: beginning.after } });
      if (ending.before) query.$and.push({ endDate: { $lte: ending.before } });
      if (ending.after) query.$and.push({ endDate: { $gte: ending.after } });

      const projection = connectionProjection(info);
      const sort = input.sort.field ? input.sort : { field: 'sectionQuery.0.start', order: 'desc' };
      const excludeProjection = input.sort.field ? undefined : ['sectionQuery.start'];

      return basedb.paginate('platform.Content', {
        query,
        sort,
        projection: { ...(!input.sort.field && { 'sectionQuery.$.start': 1 }), ...projection },
        excludeProjection,
        additionalData: { sectionId: hasSectionInput ? section._id : null },
        ...pagination,
        collate: input.sort.field === 'name',
      });
    },

    newsletterScheduledContent: async (_, { input }, { basedb, site }, info) => {
      const {
        newsletterId,
        sectionId,
        sectionName,
        ignoreStartDate,
        includeContentTypes,
        excludeContentTypes,
        limit,
        skip,
      } = input;

      // Use input timezone otherwise fallback to site/global timezone.
      const timezone = input.timezone || site.get('date.timezone', defaults.date.timezone);

      if (!sectionId && !sectionName) throw new UserInputError('Either a sectionId or sectionName input must be provided.');
      if (sectionId && sectionName) throw new UserInputError('You cannot provide both sectionId and sectionName as input.');

      const sectionQuery = { status: 1, 'deployment.$id': newsletterId };
      if (sectionId) sectionQuery._id = sectionId;
      if (sectionName) sectionQuery.name = sectionName;

      const section = await basedb.strictFindOne('email.Section', sectionQuery, { projection: { _id: 1 } });

      const date = momentTZ(input.date).tz(timezone);
      const start = date.startOf('day').toDate();
      const end = date.endOf('day').toDate();

      const scheduleSort = ignoreStartDate
        ? { deploymentDate: -1, sequence: 1 }
        : { sequence: 1, deploymentDate: 1 };

      const scheduleQuery = {
        status: 1,
        section: section._id,
        'content.type': { $in: includeContentTypes.length ? includeContentTypes : getDefaultContentTypes() },
        deploymentDate: ignoreStartDate ? { $lte: end } : { $gte: start, $lte: end },
      };
      if (excludeContentTypes.length) scheduleQuery.$and = [{ 'content.type': { $nin: excludeContentTypes } }];

      const schedules = await basedb.find('email.Schedule', scheduleQuery, {
        limit,
        skip,
        sort: scheduleSort,
        projection: { 'content.$id': 1 },
      });
      const contentIds = schedules.map(schedule => BaseDB.extractRefId(schedule.content));

      if (!contentIds.length) return [];

      const {
        fieldNodes,
        schema,
        fragments,
      } = info;
      const projection = getProjection(schema, schema.getType('Content'), fieldNodes[0].selectionSet, fragments);

      const content = await basedb.find('platform.Content', { _id: { $in: contentIds } }, { projection });

      // map and resort to match schedule order
      const contentMap = mapArray(content, '_id');
      return contentIds.map(id => contentMap.get(`${id}`)).filter(v => v);
    },

    /**
     *
     */
    relatedPublishedContent: async (_, { input }, { basedb, site }, info) => {
      const {
        contentId,
        queryTypes,
        withSite,
      } = input;
      // If no query types were specified (owned, inverse, etc), return an empty response.
      if (!queryTypes.length) return BaseDB.paginateEmpty();

      // Retrieve the content document.
      const doc = await basedb.findById('platform.Content', contentId, {
        projection: { _id: 1, relatedTo: 1, 'mutations.Website.primarySection': 1 },
      });

      // If no content document was found, return an empty response.
      if (!doc) return BaseDB.paginateEmpty();

      // Run perform the related content query.
      return relatedContent.performQuery(doc, {
        ...(withSite && { siteId: input.siteId || site.id() }),
        input,
        basedb,
        info,
      });
    },
  },

  /**
   *
   */
  Mutation: {
    /**
     *
     */
    contentCustomAttribute: async (_, { input }, { basedb, base4rest }, info) => {
      validateRest(base4rest);
      const { id, path } = input;
      const value = input.value.trim();
      const doc = await basedb.strictFindById('platform.Content', id, { projection: { type: 1, customAttributes: 1 } });
      const attrs = getAsObject(doc, 'customAttributes');
      attrs[path] = value;
      if (!value) delete attrs[path];
      const type = `platform/content/${dasherize(doc.type)}`;
      const body = new Base4RestPayload({ type });
      body.set('customAttributes', attrs);
      body.set('id', id);
      await base4rest.updateOne({ model: type, id, body });
      const projection = buildProjection({ info, type: 'Content' });
      return basedb.findById('platform.Content', id, { projection });
    },

    /**
     *
     */
    contentEventDates: updateContentMutationHandler({ allowedContentTypes: ['Event'] }),

    /**
     *
     */
    contentBody: updateContentMutationHandler({
      buildPayload: (input) => {
        const value = input.value.trim();
        const field = input.mutation ? `body${input.mutation}` : 'body';
        return { [field]: value || null };
      },
    }),

    /**
     *
     */
    contentName: updateContentMutationHandler({
      buildPayload: (input) => {
        const value = input.value.trim();
        if (!value && !input.mutation) throw new UserInputError('The default mutation of the content name cannot be empty.');
        const field = input.mutation ? `name${input.mutation}` : 'name';
        return { [field]: value || null };
      },
    }),

    /**
     *
     */
    contentTeaser: updateContentMutationHandler({
      buildPayload: (input) => {
        const value = input.value.trim();
        const field = input.mutation ? `teaser${input.mutation}` : 'teaser';
        return { [field]: value || null };
      },
    }),

    /**
     *
     */
    contentAddressFields: updateContentMutationHandler({
      allowedContentTypes: [
        'Company',
        'Contact',
        'Event',
        'Supplier',
        'Top100',
        'Venue',
      ],
    }),

    /**
     *
     */
    contentContactFields: updateContentMutationHandler({
      allowedContentTypes: [
        'Company',
        'Contact',
        'Event',
        'Supplier',
        'Venue',
      ],
    }),

    /**
     *
     */
    contentPublishing: async (_, { input }, { base4rest, basedb }, info) => {
      validateRest(base4rest);
      const { id, ...payload } = input;
      const fields = { published: 1, unpublished: 1, type: 1 };
      const doc = await basedb.strictFindById('platform.Content', id, { projection: fields });
      const type = `platform/content/${dasherize(doc.type)}`;
      const now = new Date();
      const body = new Base4RestPayload({ type });
      switch (payload.status) {
        case 'active':
          body.set('status', 1);
          if (doc.published && doc.published > now) {
            // The content is already scheduled, set to the new date.
            body.set('published', payload.published || now);
          } else {
            // Use the payload date, the content date, or the current date.
            body.set('published', payload.published || doc.published || now);
          }
          if (doc.unpublished && doc.unpublished < now) {
            // The content is already expired, set or remove the unpublished date.
            body.set('unpublished', payload.unpublished || null);
          } else if (typeof payload.unpublished !== 'undefined') {
            // Set the unpublished date, if specified.
            body.set('unpublished', payload.unpublished);
          }
          break;

        case 'draft':
          body.set('status', 2);
          body.set('published', null);
          body.set('unpublished', null);
          break;
        case 'deleted':
          body.set('status', 0);
          body.set('published', null);
          body.set('unpublished', null);
          break;
        default:
          throw new UserInputError(`The ModelStatus value '${payload.status}' is not valid for publishing.`);
      }
      body.set('id', id);
      await base4rest.updateOne({ model: type, id, body });
      const projection = buildProjection({ info, type: 'Content' });
      return basedb.findOne('platform.Content', { _id: parseInt(id, 10) }, { projection });
    },

    /**
     *
     */
    updateContentCompany: async (_, { input }, { base4rest, basedb }, info) => {
      validateRest(base4rest);
      const type = 'platform/content/company';
      const { id, payload } = input;
      const keys = Object.keys(payload);
      const body = new Base4RestPayload({ type });
      keys.forEach(k => body.set(k, payload[k]));
      body.set('id', id);
      await base4rest.updateOne({ model: type, id, body });
      const projection = buildProjection({ info, type: 'ContentCompany' });
      return basedb.findOne('platform.Content', { _id: id }, { projection });
    },

    /**
     *
     */
    updateContentCompanyImages: async (_, { input }, { base4rest, basedb }, info) => {
      validateRest(base4rest);
      const company = 'platform/content/company';
      const image = 'platform/asset/image';
      const { id, payload } = input;
      const { images, primaryImage } = payload;
      const body = new Base4RestPayload({ type: company });
      if (primaryImage) body.setLink('primaryImage', { id: primaryImage, type: image });
      if (images) body.setLinks('images', images.map(imgId => ({ id: imgId, type: image })));
      body.set('id', id);
      await base4rest.updateOne({ model: company, id, body });
      const projection = buildProjection({ info, type: 'ContentCompany' });
      return basedb.findOne('platform.Content', { _id: id }, { projection });
    },

    /**
     *
     */
    updateContentCompanyExternalLinks: async (_, { input }, { base4rest, basedb }, info) => {
      validateRest(base4rest);
      const type = 'platform/content/company';
      const { id, payload } = input;
      const { externalLinks } = payload;
      const body = new Base4RestPayload({ type });
      body.set('externalLinks', externalLinks);
      body.set('id', id);
      await base4rest.updateOne({ model: type, id, body });
      const projection = buildProjection({ info, type: 'ContentCompany' });
      return basedb.findOne('platform.Content', { _id: id }, { projection });
    },

    /**
     *
     */
    updateContentCompanySocialLinks: async (_, { input }, { base4rest, basedb }, info) => {
      validateRest(base4rest);
      const type = 'platform/content/company';
      const { id, payload } = input;
      const { socialLinks } = payload;
      const body = new Base4RestPayload({ type });
      body.set('socialLinks', socialLinks);
      body.set('id', id);
      await base4rest.updateOne({ model: type, id, body });
      const projection = buildProjection({ info, type: 'ContentCompany' });
      return basedb.findOne('platform.Content', { _id: id }, { projection });
    },

    /**
     *
     */
    updateContentCompanyYoutube: async (_, { input }, { base4rest, basedb }, info) => {
      validateRest(base4rest);
      const type = 'platform/content/company';
      const { id, payload } = input;
      const { channelId, playlistId, username } = payload;
      const body = new Base4RestPayload({ type });
      body.set('youtube.channelId', channelId);
      body.set('youtube.playlistId', playlistId);
      body.set('youtube.username', username);
      body.set('id', id);
      await base4rest.updateOne({ model: type, id, body });
      const projection = buildProjection({ info, type: 'ContentCompany' });
      return basedb.findOne('platform.Content', { _id: id }, { projection });
    },

    /**
     *
     */
    createContent: async (_, { input }, { base4rest, basedb }, info) => {
      validateRest(base4rest);
      const { primarySectionId, type, name } = input;
      const model = `platform/content/${dasherize(type)}`;
      const section = await basedb.strictFindById('website.Section', primarySectionId, { projection: { site: 1 } });
      const primarySiteId = BaseDB.extractRefId(section.site);
      await basedb.strictFindById('platform.Product', primarySiteId, { projection: { _id: 1 } });
      const body = new Base4RestPayload({ type: model });
      body.setLink('primarySiteWebsite', { id: primarySiteId, type: 'website/product/site' });
      body.setLink('primarySectionWebsite', { id: primarySectionId, type: 'website/section' });
      body.set('name', name);
      const { data } = await base4rest.insertOne({ model, body });
      const projection = buildProjection({ info, type: 'Content' });
      return basedb.findOne('platform.Content', { _id: data.id }, { projection });
    },

    /**
     *
     */
    createContentContact: async (_, { input }, { base4rest, basedb }, info) => {
      validateRest(base4rest);
      const type = 'platform/content/contact';
      const { primarySectionId, ...payload } = input.payload;
      const section = await basedb.strictFindById('website.Section', primarySectionId, { projection: { site: 1 } });
      const primarySiteId = BaseDB.extractRefId(section.site);
      await basedb.strictFindById('platform.Product', primarySiteId, { projection: { _id: 1 } });
      const keys = Object.keys(payload);
      const body = new Base4RestPayload({ type });
      body.setLink('primarySiteWebsite', { id: primarySiteId, type: 'website/product/site' });
      body.setLink('primarySectionWebsite', { id: primarySectionId, type: 'website/section' });
      keys.forEach(k => body.set(k, payload[k]));
      const { data } = await base4rest.insertOne({ model: type, body });
      const projection = buildProjection({ info, type: 'ContentContact' });
      return basedb.findOne('platform.Content', { _id: data.id }, { projection });
    },

    /**
     *
     */
    updateContentContact: async (_, { input }, { base4rest, basedb }, info) => {
      validateRest(base4rest);
      const type = 'platform/content/contact';
      const { id, payload } = input;
      const body = new Base4RestPayload({ type });
      Object.keys(payload).forEach(k => body.set(k, payload[k]));
      body.set('id', id);
      await base4rest.updateOne({ model: type, id, body });
      const projection = buildProjection({ info, type: 'ContentContact' });
      return basedb.findOne('platform.Content', { _id: id }, { projection });
    },

    /**
     *
     */
    updateContentContactImages: async (_, { input }, { base4rest, basedb }, info) => {
      validateRest(base4rest);
      const contact = 'platform/content/contact';
      const image = 'platform/asset/image';
      const { id, payload } = input;
      const { imageIds, primaryImageId } = payload;
      const body = new Base4RestPayload({ type: contact });
      if (primaryImageId) body.setLink('primaryImage', { id: primaryImageId, type: image });
      if (imageIds) body.setLinks('images', imageIds.map(imgId => ({ id: imgId, type: image })));
      body.set('id', id);
      await base4rest.updateOne({ model: contact, id, body });
      const projection = buildProjection({ info, type: 'ContentContact' });
      return basedb.findOne('platform.Content', { _id: id }, { projection });
    },

    /**
     *
     */
    createContentPromotion: async (_, { input }, { base4rest, basedb }, info) => {
      validateRest(base4rest);
      const type = 'platform/content/promotion';
      const { primarySectionId, companyId, ...payload } = input.payload;
      const section = await basedb.strictFindById('website.Section', primarySectionId, { projection: { site: 1 } });
      const primarySiteId = BaseDB.extractRefId(section.site);
      await basedb.strictFindById('platform.Product', primarySiteId, { projection: { _id: 1 } });
      const keys = Object.keys(payload);
      const body = new Base4RestPayload({ type });
      if (companyId) body.setLink('company', { id: companyId, type: 'platform/content/company' });
      body.setLink('primarySiteWebsite', { id: primarySiteId, type: 'website/product/site' });
      body.setLink('primarySectionWebsite', { id: primarySectionId, type: 'website/section' });
      keys.forEach(k => body.set(k, payload[k]));
      const { data } = await base4rest.insertOne({ model: type, body });
      const projection = buildProjection({ info, type: 'ContentPromotion' });
      return basedb.findOne('platform.Content', { _id: data.id }, { projection });
    },

    /**
     *
     */
    updateContentPromotion: async (_, { input }, { base4rest, basedb }, info) => {
      validateRest(base4rest);
      const type = 'platform/content/promotion';
      const { id, payload } = input;
      const body = new Base4RestPayload({ type });
      Object.keys(payload).forEach(k => body.set(k, payload[k]));
      body.set('id', id);
      await base4rest.updateOne({ model: type, id, body });
      const projection = buildProjection({ info, type: 'ContentPromotion' });
      return basedb.findOne('platform.Content', { _id: id }, { projection });
    },

    /**
     *
     */
    updateContentPromotionImages: async (_, { input }, { base4rest, basedb }, info) => {
      validateRest(base4rest);
      const type = 'platform/content/promotion';
      const image = 'platform/asset/image';
      const { id, payload } = input;
      const { imageIds, primaryImageId } = payload;
      const body = new Base4RestPayload({ type });
      if (primaryImageId) body.setLink('primaryImage', { id: primaryImageId, type: image });
      if (imageIds) body.setLinks('images', imageIds.map(imgId => ({ id: imgId, type: image })));
      body.set('id', id);
      await base4rest.updateOne({ model: type, id, body });
      const projection = buildProjection({ info, type: 'ContentPromotion' });
      return basedb.findOne('platform.Content', { _id: id }, { projection });
    },

    /**
     *
     */
    updateContentCompanyPublicContacts: async (_, { input }, { base4rest, basedb }, info) => {
      validateRest(base4rest);
      const type = 'platform/content/contact';
      const { id, payload: { contactIds } } = input;
      const body = new Base4RestPayload({ type: 'platform/content/company' });
      body.set('id', id);
      body.setLinks('publicContacts', contactIds.map(i => ({ id: i, type })));
      await base4rest.updateOne({ model: 'platform/content/company', id, body });
      const projection = buildProjection({ info, type: 'ContentCompany' });
      return basedb.findOne('platform.Content', { _id: id }, { projection });
    },
  },
};
