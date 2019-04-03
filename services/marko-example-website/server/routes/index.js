const contentTypes = require('./content');
const dynamicPages = require('./dynamic-page');
const index = require('../templates/index');
const loadMore = require('./load-more');
const websiteSections = require('./website-section');
const magazine = require('./magazine');

module.exports = (app) => {
  // Trusted proxies
  app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

  // Homepage
  app.get('/', (req, res) => {
    res.marko(index);
  });

  // Load More / Infinite Scroll
  loadMore(app);

  // Dynamic Pages
  dynamicPages(app);

  // Magazine Pages
  magazine(app);

  // Content Types
  contentTypes(app);

  // Website Sections
  websiteSections(app);

  // @todo Future routing concepts...
  // route('content', {
  //   type: '*',
  //   template: content,
  // });

  // route('content', {
  //   type: 'article',
  //   template: contentArticle,
  // });

  // route('content', {
  //   type: 'company',
  //   template: contentCompany,
  // });

  // route('content', {
  //   id: 12345678,
  //   template: contentCompany,
  // });
};
