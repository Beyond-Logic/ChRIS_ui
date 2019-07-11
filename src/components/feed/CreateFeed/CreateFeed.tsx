import * as React from "react";
import { connect } from 'react-redux';
import { Dispatch } from "redux";
import _ from 'lodash';

import Client, { Plugin, UploadedFile, Tag, PluginInstance, Collection } from "@fnndsc/chrisapi";
import { Button, Wizard } from "@patternfly/react-core";

import { IFeedItem } from "../../../api/models/feed.model";
import { addFeed } from "../../../store/feed/actions";
import { ApplicationState } from "../../../store/root/applicationState";

import BasicInformation from "./BasicInformation";
import ChrisFileSelect from "./ChrisFileSelect";
import LocalFileUpload from "./LocalFileUpload";
import Review from "./Review";

import './createfeed.scss';

export declare var process: { 
  env: {
    REACT_APP_CHRIS_UI_URL: string
  }
};

export interface ChrisFile {
  name: string,
  path: string, // full path, including file name
  id?: number, // only defined for files
  blob?: Blob, // only defined for files
  children?: ChrisFile[],
  collapsed?: boolean,
}

export interface LocalFile {
  name: string,
  blob: Blob,
}

export type DataFile = ChrisFile | LocalFile;

export interface CreateFeedData {
  feedName: string,
  feedDescription: string,
  tags: Tag[],
  chrisFiles: ChrisFile[],
  localFiles: LocalFile[],
}

function getDefaultCreateFeedData(): CreateFeedData {
  return {
    feedName: '',
    feedDescription: '',
    tags: [],
    chrisFiles: [],
    localFiles: [],
  }
}

interface CreateFeedProps {
  authToken: string,
  addFeed: (feed: IFeedItem) => void,
}

interface CreateFeedState {
  wizardOpen: boolean,
  saving: boolean,
  step: number,
  data: CreateFeedData
}

class CreateFeed extends React.Component<CreateFeedProps, CreateFeedState> {

  client: Client = new Client(process.env.REACT_APP_CHRIS_UI_URL, { token: this.props.authToken });

  constructor(props: CreateFeedProps) {
    super(props);
    this.state = {
      wizardOpen: false,
      saving: false,
      step: 1,
      data: getDefaultCreateFeedData()
    }

    this.toggleCreateWizard = this.toggleCreateWizard.bind(this);
    this.handleStepChange = this.handleStepChange.bind(this);
    this.handleSave = this.handleSave.bind(this);
    this.getStepName = this.getStepName.bind(this);
    this.handleFeedNameChange = this.handleFeedNameChange.bind(this);
    this.handleFeedDescriptionChange = this.handleFeedDescriptionChange.bind(this);
    this.handleTagsChange = this.handleTagsChange.bind(this);
    this.handleChrisFileAdd = this.handleChrisFileAdd.bind(this);
    this.handleChrisFileRemove = this.handleChrisFileRemove.bind(this);
    this.handleLocalFilesAdd = this.handleLocalFilesAdd.bind(this);
    this.handleLocalFileRemove = this.handleLocalFileRemove.bind(this);
    this.createFeed = this.createFeed.bind(this);
  }
  /*
    -------------- 
    EVENT HANDLERS 
    --------------
  */

  // WIZARD HANDLERS

  resetState() {
    this.setState({ 
      data: getDefaultCreateFeedData(),
      step: 1,
      saving: false,
    });
  }

  closeCreateWizard() {
    this.setState({ wizardOpen: false });
  }

  toggleCreateWizard() {
    if (this.state.wizardOpen) {
      this.resetState();
    }
    this.setState({
      wizardOpen: !this.state.wizardOpen
    })
  }

  handleStepChange(step: any) {
    this.setState({ step: step.id });
  }

  handleSave() {
    this.createFeed();
  }

  getStepName(): string {
    const stepNames = ['basic-information', 'chris-file-select', 'local-file-upload', 'review'];
    return stepNames[this.state.step - 1]; // this.state.step starts at 1
  }

  // BASIC INFORMATION HANDLERS

  handleFeedNameChange(val: string) {
    this.setState({ data: { ...this.state.data, feedName: val }});3
  }
  handleFeedDescriptionChange(val: string) {
    this.setState({ data: { ...this.state.data, feedDescription: val }});
  }
  handleTagsChange(tags: Tag[]) {
    this.setState({ data: { ...this.state.data, tags }});
  }

  // CHRIS FILE SELECT HANDLERS

  handleChrisFileAdd(file: ChrisFile) {
    this.setState({ data: { 
      ...this.state.data, 
      chrisFiles: [...this.state.data.chrisFiles, file ]
    }});
  }
  
  handleChrisFileRemove(file: ChrisFile) {
    this.setState({ data: {
      ...this.state.data,
      chrisFiles: this.state.data.chrisFiles.filter(f => f.path !== file.path)
    }});
  }

  // LOCAL FILE UPLOAD HANDLERS
  
  handleLocalFilesAdd(files: LocalFile[]) {
    this.setState({ data: { ...this.state.data, localFiles: [ ...this.state.data.localFiles, ...files ] } })
  }
  handleLocalFileRemove(fileName: string) {
    this.setState({ 
      data: {
        ...this.state.data,
        localFiles: this.state.data.localFiles.filter(file => file.name !== fileName)
      }
    })
  }

  /*
    -------------
    FEED CREATION
    -------------
  */

  // CHRIS FILES

  // recursively get all files and sub-files in a root ChRIS folder
  getChrisFolderChildren(folder: ChrisFile) {
    if (!folder.children) {
      return [];
    }
    const children: ChrisFile[] = [];
    for (const child of folder.children) {
      if (child.children) {
        children.push(...this.getChrisFolderChildren(child));
      } else {
        children.push(child);
      }
    }
    return children;
  }

  // gets all selected files, including files whose parent folder has been selected. excludes folders.
  getAllSelectedChrisFiles(): ChrisFile[] {
    const { chrisFiles } = this.state.data;
    const files = chrisFiles.filter(file => !file.children); // directly selected files
    const folders = chrisFiles.filter(file => file.children); // directly selected folders
    const folderChildren = _.flatten( // children of selected folders
      folders.map(f => this.getChrisFolderChildren(f))
    );
    const allSelectedFiles = [ ...folderChildren, ...files ];
    return _.uniqBy(allSelectedFiles, f => f.id); // deduplicate based on id
  }

  // TEMPORARY DIRECTORY

  /* dircopy is run on a single directory, so all selected/uploaded files need to be moved into
     a temporary directory. This fn generates its name, based on the feed name.
     the files are removed afterwards. however, in case the script fails or the page is closed, 
     having it be in a (probably) seperate directory will minimize the risk of it getting mixed up
  */
  generateTempDirName() {
    const randomCode = Math.floor(Math.random() * 10000); // random 4-digit code, to minimize risk of folder already existing
    const normalizedFeedName = this.state.data.feedName
      .toLowerCase()
      .replace(/ /g, '-')
      .replace(/\//g, '');
    return `/${normalizedFeedName}-temp-${randomCode}`;
  }

  async uploadFilesToTempDir(files: DataFile[], getFilePath: Function): Promise<UploadedFile[]> {
    const uploadedFiles = await this.client.getUploadedFiles();

    const pendingUploads = files.map(file => {
      const blob = file.blob || new Blob([]); 
      return uploadedFiles.post({
        upload_path: getFilePath(file)
      }, {
        fname: blob
      })
    });
    return Promise.all(pendingUploads);
  }

  // Local files are uploaded into the temp directory
  async uploadLocalFiles(tempDirName: string) {
    const files = this.state.data.localFiles;
    const getFilePath = (file: LocalFile) => `/${tempDirName}/${file.name}`;
    return this.uploadFilesToTempDir(files, getFilePath);
  }
  
  // Selected ChRIS files are copied into the temp directory
  async copyChrisFiles(tempDirName: string) {
    const files = this.getAllSelectedChrisFiles();
    const getFilePath = (file: ChrisFile) => `/${tempDirName}/${file.path}`;
    return this.uploadFilesToTempDir(files, getFilePath);
  }

  // TODO: what if the file already existed and this overwrote it?? aaah
  async removeTempFiles(tempDirName: string) {
    const files = [...this.getAllSelectedChrisFiles(), ...this.state.data.localFiles];
    const uploadedFiles = (await this.client.getUploadedFiles()).getItems() || [];
    
    for (const uploadedFile of uploadedFiles) {
      const path = uploadedFile.data.upload_path;
      const matchesFile = files.find(f => `${tempDirName}/${f.name}` === path);
      if (matchesFile) {
        uploadedFile.delete();
      }
    }
  }

  // DIRCOPY PLUGIN

  async getDircopyPlugin(): Promise<Plugin | null> {
    let dircopyPlugin;
    let page = 0;
    do {
      const pluginsPage = (await this.client.getPlugins({ limit: 25, offset: page * 25 }));
      const plugins = pluginsPage.getItems() || [];
      if (!plugins) {
        return null;
      }
      dircopyPlugin = plugins.find((plugin: Plugin) => plugin.data.name === 'dircopy');
      page++;
    } while (!dircopyPlugin);
    return dircopyPlugin;
  }

  async createFeed() {
    
    this.setState({ saving: true });
    const tempDirName = this.generateTempDirName();

    try {

      await this.client.getFeeds(); // getFeeds must be called on new Client objects
      
      // Upload/copy files
      await this.uploadLocalFiles(tempDirName);
      await this.copyChrisFiles(tempDirName);

      // Find dircopy plugin
      const dircopy = await this.getDircopyPlugin();
      if (!dircopy) {
        console.log('Dircopy not found. Giving up.');
        return;
      }

      // Create new instance of dircopy plugin
      const dircopyInstances = await dircopy.getPluginInstances();
      await dircopyInstances.post({
        dir: tempDirName
      });

      // when the `post` finishes, the dircopyInstances's internal collection is updated
      const createdInstance: PluginInstance = (dircopyInstances.getItems() || [])[0];
      if (!createdInstance) {
        alert('Everything has broken. Run for the hills');
        return;
      }
      
      // Retrieve created feed
      const feed = await createdInstance.getFeed();
      if (!feed) {
        alert('Everything has broken. Ahhhhh.');
        return;
      }
      
      // Remove temporary files
      this.removeTempFiles(tempDirName);

      // Set feed name
      await feed.put({ 
        name: this.state.data.feedName 
      });

      // Set feed tags
      for (const tag of this.state.data.tags) {
        feed.tagFeed(tag.data.id);
      }

      // Set feed description
      const note = await feed.getNote();
      await note.put({
        title: 'Description',
        content: this.state.data.feedDescription
      }, 1000);

      // Add data to redux
      const { data, collection } = feed;
      const createdFeedLinks = collection.items[0];

      const getLinkUrl = (resource: string) => {
        return Collection.getLinkRelationUrls(createdFeedLinks, resource)[0];
      }

      const feedObj = {
        name: this.state.data.feedName,
        note: this.state.data.feedDescription,
        id: feed.data.id,
        creation_date: data.creation_date,
        modification_date: data.modification_date,
        creator_username: data.creator_username,
        owner: [data.owner_username],
        url: feed.url,
        files: getLinkUrl('files'),
        comments: getLinkUrl('comments'),
        tags: getLinkUrl('tags'),
        taggings: getLinkUrl('taggings'),
        plugin_instances: getLinkUrl('plugininstances')
      }

      this.props.addFeed(feedObj);

    } catch (e) {
      this.removeTempFiles(tempDirName); // clean up temp files if anything failed
      console.error(e);
    } finally {
      this.resetState();
      this.closeCreateWizard();
    }
  }

  render() {

    const { data } = this.state;

    const enableSave = (data.chrisFiles.length > 0 || data.localFiles.length > 0) && !this.state.saving;

    const basicInformation = <BasicInformation
      authToken={ this.props.authToken }
      feedName={ data.feedName }
      feedDescription={ data.feedDescription }
      tags={ data.tags }
      handleFeedNameChange={ this.handleFeedNameChange }
      handleFeedDescriptionChange={ this.handleFeedDescriptionChange }
      handleTagsChange={ this.handleTagsChange }
    />;

    const chrisFileSelect = <ChrisFileSelect
      files={ data.chrisFiles }
      handleFileAdd={ this.handleChrisFileAdd }
      handleFileRemove={ this.handleChrisFileRemove }
      authToken={ this.props.authToken }
    />;
    
    const localFileUpload = <LocalFileUpload
      files={ data.localFiles }
      handleFilesAdd={ this.handleLocalFilesAdd }
      handleFileRemove={ this.handleLocalFileRemove }
    />;

    const review = <Review data={ data } />

    const steps = [
      { 
        id: 1, // id corresponds to step number
        name: 'Basic Information', 
        component: basicInformation,
        enableNext: !!data.feedName
      },
      { 
        name: 'Data Configuration',
        steps: [
          { id: 2, name: 'ChRIS File Select', component: chrisFileSelect },
          { id: 3, name: 'Local File Upload', component: localFileUpload },
        ] 
      },
      { id: 4, name: 'Review', component: review, enableNext: enableSave},
    ];

    return (
      <React.Fragment>
        <Button className="create-feed-button" variant="primary" onClick={this.toggleCreateWizard}>
          Create Feed
        </Button>
        {
          this.state.wizardOpen && (
            <Wizard
              isOpen={this.state.wizardOpen}
              onClose={this.toggleCreateWizard}
              title="Create a New Feed"
              description="This wizard allows you to create a new feed and add an initial dataset to it."
              className={`feed-create-wizard ${this.getStepName()}-wrap`}
              steps={steps}
              startAtStep={this.state.step}
              onNext={this.handleStepChange}
              onBack={this.handleStepChange}
              onGoToStep={this.handleStepChange}
              onSave={this.handleSave}
            />
          )
      }
      </React.Fragment>
    )
  }
}

const mapStateToProps = (state: ApplicationState) => ({
  authToken: state.user.token || '',
})

const mapDispatchToProps = (dispatch: Dispatch) => ({
  addFeed: (feed: IFeedItem) => dispatch(addFeed(feed))
});

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(CreateFeed);