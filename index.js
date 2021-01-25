const camelCase = require('camelcase')
const Parse = require('parse/node');

const SITE_MODEL_NAME = 'Site';
const MODEL_MODEL_NAME = 'Model';
const MODEL_FIELD_MODEL_NAME = 'ModelField';
const MEDIA_ITEM_MODEL_NAME = 'MediaItem';

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
      await this.getMediaItems(store)
      await this.getEntries(store)
    })
  }

  // Core method
  async getMediaItems (store) {
    const MediaItemModel = Parse.Object.extend(MEDIA_ITEM_MODEL_NAME);
    const SiteModel = Parse.Object.extend(SITE_MODEL_NAME);
    const mediaItemQuery = new Parse.Query(MediaItemModel);
    mediaItemQuery.equalTo('site', new SiteModel({ id: this.options.siteId }));
    const typeName = this.createTypeName('MediaItem')
    const collection = store.addCollection(typeName);

    const mediaItems = await mediaItemQuery.find();
    for (const mediaItem of mediaItems) {
      const node = {
        id: mediaItem.id,
        title: mediaItem.get('name'),
        type: mediaItem.get('type'),
        file: mediaItem.get('file')
      }
      collection.addNode(node);
    }
  }

  // Core method
  async getContentTypes (store) {
    const ModelModel = Parse.Object.extend(MODEL_MODEL_NAME);
    const SiteModel = Parse.Object.extend(SITE_MODEL_NAME);

    const modelQuery = new Parse.Query(ModelModel);
    
    modelQuery.equalTo('site', new SiteModel({id: this.options.siteId}));
    const models = await modelQuery.find();
    this.modelsArray = await Promise.all(
      models.map(async modelRecord => {
        // model meta info and register
        const name = modelRecord.get('nameId');
        const typeName = this.createTypeName(name)
        store.addCollection(typeName);

        const { fields, displayFieldName } = await this.prepareModelFieldsDefinition(modelRecord);

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

  // Core method
  async getEntries (store) {
    for (const model of this.modelsArray) {
      const { name, typeName, tableName, displayName, id, fields } = model;
      const collection = store.getCollection(typeName);
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
          node[field.nameId] = this.getFieldValue(entry, field, store);          
        }
        collection.addNode(node);
      }
    }
  }

  // Get field value for getEntries core method
  getFieldValue (entry, field, store) {
    try {
      const key = field.nameId;
      const value = entry.get(key);
      if (value) {
        if (field.isList) {
          return this.getFieldListValue(field.type, value, store);
        } else if (field.type === 'Reference') {
          return value.map(item => this.convertReferenceValue(item, store));
        } else if (field.type === 'Media') {
          return store.createReference(this.createTypeName(MEDIA_ITEM_MODEL_NAME), value.id)
        }
        return value;
      }
      return null;
    } catch (error) {
      console.log("error while getFieldValue value/error", field, error);
      return null;
    }
  }

  // Special conversion for List(of Reference, Media or plain item), Reference and Media
  getFieldListValue (fieldType, value, store) {
    return value.map(item => {
      if (item) {
        if (fieldType === 'Reference') {
          return this.convertReferenceValue(item, store);
        } 
        if (fieldType === 'Media') {
          return store.createReference(this.createTypeName(MEDIA_ITEM_MODEL_NAME), item.id); 
        }
        return item;
      }
      return null;
    });
  }

  // Prepare model fields definition, called from getContentTypes
  async prepareModelFieldsDefinition (modelRecord) {
    const ModelFieldModel = Parse.Object.extend(MODEL_FIELD_MODEL_NAME);
    const modelFieldQuery = new Parse.Query(ModelFieldModel);
    modelFieldQuery.equalTo('model', modelRecord);
    modelFieldQuery.equalTo('isDisabled', false);
    const modelFields = await modelFieldQuery.find();

    if (modelFields && modelFields.length < 1) return { fields: null, displayFieldname: null };

    let displayFieldName = modelFields[0].get('name');
    const fields = modelFields.map(modelFieldRecord => {
      if (modelFieldRecord.get('isRequired')) displayFieldName = modelFieldRecord.get('nameId');
      return {
        nameId: modelFieldRecord.get('nameId'),
        name: modelFieldRecord.get('name'),
        isList: modelFieldRecord.get('isList'),
        type: modelFieldRecord.get('type')
      }
    });

    return { fields, displayFieldName };
  }

  convertReferenceValue(item, store) {
    const typeName = this.getTypeNameFromTableName(item.className);
    return typeName ? store.createReference(typeName, item.id) : '';
  }

  createTypeName (name = '') {
    return camelCase(`${this.options.typeName} ${name}`, { pascalCase: true })
  }

  getTypeNameFromTableName (tableName) {
    const modelRecord = this.modelsArray.find(model => model.tableName === tableName);
    return modelRecord ? modelRecord.typeName : null;
  }

}

module.exports = ChiselSource