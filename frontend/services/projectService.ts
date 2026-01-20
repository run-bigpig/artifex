import {
  CreateProject,
  GetActiveProject,
  ListProjects,
  OpenProject,
  SelectProjectDirectory
} from '../wailsjs/go/core/App';

export interface ProjectInfo {
  id: string;
  path: string;
}

export const getActiveProject = async (): Promise<ProjectInfo> => {
  const result = await GetActiveProject();
  return JSON.parse(result);
};

export const listProjects = async (): Promise<ProjectInfo[]> => {
  const result = await ListProjects();
  return JSON.parse(result);
};

export const createProject = async (projectId: string): Promise<ProjectInfo> => {
  const result = await CreateProject(projectId);
  return JSON.parse(result);
};

export const selectProjectDirectory = async (): Promise<string> => {
  return SelectProjectDirectory();
};

export const openProject = async (projectPath: string): Promise<ProjectInfo> => {
  const result = await OpenProject(projectPath);
  return JSON.parse(result);
};
