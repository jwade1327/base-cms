const MongoClient = require('./mongodb');

/**
 * The Base4 collection namespaces.
 *
 * These are used to calculcate the MongoDB
 * database names.
 *
 * @type {string[]}
 */
const namespaces = [
  'email',
  'magazine',
  'platform',
  'website',
];

class BaseDB {
  /**
   * @param {object} baseOpts The Base connection options.
   * @param {string} baseOpts.url The Base MongoDB URL to connect to.
   * @param {string} baseOpts.tenant The Base tenant key, e.g. `cygnus_ofcr`.
   * @param {object} [options] Options to pass to `MongoClient.connect`.
   */
  constructor({ url, tenant } = {}, options) {
    this.tenant(tenant);
    this.dbOptions = options;
    this.client = new MongoClient(url, options);
  }

  /**
   * Sets the tenant.
   *
   * @param {string} key The Base tenant key, e.g. `cygnus_ofcr`.
   */
  tenant(key) {
    this.tenant = key;
    return this;
  }

  /**
   * @param {string} namespace The model namespace, e.g. `platform` or `website`.
   * @param {object} [options] Options to pass to the `MongoClient.db` call.
   */
  db(namespace, options) {
    return this.client.db(this.dbNameFor(namespace), options);
  }

  /**
   * @param {string} namespace The model namespace, e.g. `platform` or `website`.
   * @param {string} resource The resource/collection name, e.g. `Content` or `Section`.
   * @param {object} [options] Options to pass to the `Db.collection` call.
   */
  async collection(namespace, resource, options) {
    return this.client.collection(this.dbNameFor(namespace), resource, options);
  }

  /**
   * Creates the database name for the active tenant.
   *
   * @param {string} namespace The model namespace, e.g. `platform` or `website`.
   */
  dbNameFor(namespace) {
    if (!namespaces.includes(namespace)) {
      throw new Error(`The provided Base namespace '${namespace}' is invalid.`);
    }
    return `${this.tenant}_${namespace}`;
  }
}

module.exports = BaseDB;
