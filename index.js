const camelCase = require('camelcase')
const Parse = require('parse/node');

const MODEL_MODEL_NAME = 'Model';
const MODEL_FIELD_MODEL_NAME = 'ModelField';
const SITE_MODEL_NAME = 'Site';

class ChiselSource {
  static defaultOptions () {
    return {
      environment: 'master',
      serverURL: undefined,
      appId: undefined,
      masterKey: undefined,
      siteId: undefined,
      typeName: 'Chisel'
    }
  }

  constructor (api, options) {
    this.options = options
    this.typesIndex = {}
    this.modelsArray = [];

    Parse.initialize(options.appId, null, options.masterKey);
    Parse.serverURL = options.serverURL;
    Parse.Cloud.useMasterKey();


    api.loadSource(async store => {
      await this.getContentTypes(store)
      await this.getEntries(store)
    })
  }

  async getContentTypes (actions) {
    const ModelModel = Parse.Object.extend(MODEL_MODEL_NAME);
    const ModelFieldModel = Parse.Object.extend(MODEL_FIELD_MODEL_NAME);
    const SiteModel = Parse.Object.extend(SITE_MODEL_NAME);

    const modelQuery = new Parse.Query(ModelModel);
    
    modelQuery.equalTo('site', new SiteModel({id: this.options.siteId}));
    const models = await modelQuery.find();
    this.modelsArray = await Promise.all(
      models.map(async modelRecord => {
        // model meta info and register
        const name = modelRecord.get('nameId');
        const typeName = this.createTypeName(name)
        actions.addCollection(typeName);

        // Prepare model fields
        const modelFieldQuery = new Parse.Query(ModelFieldModel);
        modelFieldQuery.equalTo('model', modelRecord);
        modelFieldQuery.equalTo('isDisabled', false);
        const modelFields = await modelFieldQuery.find();
        let displayFieldName = modelFields[0].get('name');
        const fields = modelFields.map(modelFieldRecord => {
          if (modelFieldRecord.get('isRequired')) displayFieldName = modelFieldRecord.get('nameId');
          return {
            nameId: modelFieldRecord.get('nameId'),
            name: modelFieldRecord.get('name')
          }
        });

        console.log("type name", typeName);
        return {
          name,
          typeName,
          id: modelRecord.id,
          tableName: modelRecord.get('tableName'),
          displayName: displayFieldName,
          fields
        }
      })
    );
 
  }

  async getEntries (actions) {
    for (const model of this.modelsArray) {
      const { name, typeName, tableName, displayName, id, fields } = model;
      const collection = actions.getCollection(typeName);
      const query = new Parse.Query(tableName);
      query.equalTo('t__status', 'Published');
      const entries = await query.find();
      for (const entry of entries) {
        const node = {}
        node.id = entry.id;
        node.title = entry.get(displayName);
        node.date = entry.get('createdAt');
        node.createdAt = entry.get('createdAt');
        node.updatedAt = entry.get('updatedAt');
        for (const field of fields) {
          node[field.nameId] = entry.get(field.nameId);
        }
        console.log("node", typeName, node);
        collection.addNode(node);
      }
    }
  }

  createTypeName (name = '') {
    return camelCase(`${this.options.typeName} ${name}`, { pascalCase: true })
  }

}

module.exports = ChiselSource