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

  async getMediaItems (actions) {
    console.log("passed me, getMediaItems");
    const MediaItemModel = Parse.Object.extend(MEDIA_ITEM_MODEL_NAME);
    const SiteModel = Parse.Object.extend(SITE_MODEL_NAME);
    const mediaItemQuery = new Parse.Query(MediaItemModel);
    mediaItemQuery.equalTo('site', new SiteModel({ id: this.options.siteId }));
    const typeName = this.createTypeName('MediaItem')
    const collection = actions.addCollection(typeName);

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

  async getContentTypes (actions) {
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
        actions.addCollection(typeName);

        const { fields, displayFieldName } = await this.prepareModelFields(modelRecord);

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
    console.log("this modelsArray", this.modelsArray);
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
          const key = field.nameId;
          const value = entry.get(key);
          if (value) {
            if (field.isList) {
              node[field.nameId] = value.map(item => {
                if (field.type === 'Reference' && item) {
                  console.log("inside reference list", item);               
                  const typeName = this.getTypeNameFromTableName(item.className);
                  return typeName ? actions.createReference(typeName, item.id) : '';
                } 
                return null;
              });
            } else if (field.type === 'Reference') {
              node[field.nameId] = value.map(atom => {
                const typeName = this.getTypeNameFromTableName(atom.className);
                return typeName ? actions.createReference(typeName, atom.id) : '';
              })
              /* const typeName = this.getTypeNameFromTableName(value.tableName);
              console.log("reference typeName", value, typeName)
              node[field.nameId] =  typeName ? actions.createReference(typeName, item.id) : '';*/
            } else if (field.type === 'Media') {
              // node[field.nameId] = value ? actions.createReference(value.className, value.id) : null;
            } else
              node[field.nameId] = value;
          } else
            node[field.nameId] = null;
        }
        collection.addNode(node);
      }
    }
  }

  createTypeName (name = '') {
    return camelCase(`${this.options.typeName} ${name}`, { pascalCase: true })
  }

  toReferencesArray (value) {
    
  }

  getTypeNameFromTableName (tableName) {
    const modelRecord = this.modelsArray.find(model => model.tableName === tableName);
    return modelRecord ? modelRecord.typeName : null;
  }
  // Prepare model fields, called from getContentTypes
  async prepareModelFields (modelRecord) {
    const ModelFieldModel = Parse.Object.extend(MODEL_FIELD_MODEL_NAME);
    const modelFieldQuery = new Parse.Query(ModelFieldModel);
    modelFieldQuery.equalTo('model', modelRecord);
    modelFieldQuery.equalTo('isDisabled', false);
    const modelFields = await modelFieldQuery.find();
    let displayFieldName = modelFields[0].get('name');

    const fields = modelFields.map(modelFieldRecord => {
      if (modelFieldRecord.get('isRequired')) displayFieldName = modelFieldRecord.get('nameId');
      if (modelFieldRecord.get('type') === 'Reference') console.log("reference", JSON.stringify(modelFieldRecord));
      return {
        nameId: modelFieldRecord.get('nameId'),
        name: modelFieldRecord.get('name'),
        isList: modelFieldRecord.get('isList'),
        type: modelFieldRecord.get('type')
      }
    });

    return { fields, displayFieldName };
  }
}

module.exports = ChiselSource