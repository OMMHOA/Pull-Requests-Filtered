import { getService } from "azure-devops-extension-sdk";
import { IFilterState } from "azure-devops-ui/Utilities/Filter";

import {
    CommonServiceIds,
    getClient,
    IProjectInfo,
    IProjectPageService
} from "azure-devops-extension-api/Common";

import {
    CoreRestClient,
    TeamProjectReference
} from "azure-devops-extension-api/Core";

import {
    GitPullRequest,
    GitRepository,
    GitRestClient
} from "azure-devops-extension-api/Git";

import {
    WorkItemTrackingRestClient
} from "azure-devops-extension-api/WorkItemTracking";

import {
    IdentitiesGetConnectionsResponseModel,
    IdentitiesSearchRequestModel,
    IdentityServiceIds,
    IIdentity,
    IPeoplePickerProvider,
    IVssIdentityService
} from "azure-devops-extension-api/Identities";

import { createQueryCriteria } from "./Filtering";

export class IdentityPickerProvider implements IPeoplePickerProvider {

    public readonly identityService: Promise<IVssIdentityService>;

    constructor() {
        this.identityService = getService<IVssIdentityService>(IdentityServiceIds.IdentityService);
    }

    public async addIdentitiesToMRU(identities: IIdentity[]) : Promise<boolean> {
        const identityService = await this.identityService;
        return await identityService.addMruIdentitiesAsync(identities);
    };

    public async removeIdentitiesFromMRU(identities: IIdentity[]) : Promise<boolean> {
        const identityService = await this.identityService;
        return await identityService.removeMruIdentitiesAsync(identities);
    };

    public async getEntityFromUniqueAttribute(entityId: string): Promise<IIdentity> {
        const identityService = await this.identityService;
        const x = await identityService.searchIdentitiesAsync(entityId, undefined, undefined, "uid");
        return x[0];
    };

    public async onEmptyInputFocus(): Promise<IIdentity[]> {
        const timeout = new Promise<void>((resolve, reject) => setTimeout(() => resolve(), 150));
        const result = await this.onEmptyInputFocusEnforced();
        await timeout;
        return result;
    }

    public onFilterIdentities(filter: string, selectedItems?: IIdentity[]): Promise<IIdentity[]> {
        return this.onSearchPersona(filter, selectedItems ? selectedItems : []);
    };

    public async onRequestConnectionInformation(
        entity: IIdentity,
        getDirectReports?: boolean)
        : Promise<IdentitiesGetConnectionsResponseModel>
    {
        const identityService = await this.identityService;
        return await identityService.getConnections(entity, getDirectReports);
    };

    public async onEmptyInputFocusEnforced(): Promise<IIdentity[]> {
        const identityService = await this.identityService;
        return await identityService.getIdentityMruAsync();
    }

    private async onSearchPersona(searchText: string, items: IIdentity[]): Promise<IIdentity[]> {
        const searchRequest: IdentitiesSearchRequestModel = { query: searchText };
        const identityService = await this.identityService;
        const identities = await identityService.searchIdentitiesAsync(
            searchRequest.query,
            searchRequest.identityTypes,
            searchRequest.operationScopes,
            searchRequest.queryTypeHint,
            searchRequest.options
        );

        return identities.filter(
            identity => !items.some(
                selectedIdentity => selectedIdentity.entityId === identity.entityId));
    };
}

export async function loadProject(): Promise<IProjectInfo> {
    const projectService = await getService<IProjectPageService>(CommonServiceIds.ProjectPageService);
    const project = await projectService.getProject();
    if (project === undefined) {
        throw "Unknown loading context.";
    }

    return project;
}

export async function loadRepos(projectId?: string): Promise<GitRepository[]> {
    return await getClient(GitRestClient).getRepositories(projectId, true);
}

/**
 * Returns all projects in the organization.
 * Used by the widget to populate the project multi-select and to query PRs
 * across selected projects.
 */
export async function loadProjects(): Promise<TeamProjectReference[]> {
    // Azure DevOps paginates at 100 by default. Fetch up to 1000 projects.
    return await getClient(CoreRestClient).getProjects(undefined, 1000);
}

/**
 * Returns true if the given pull request has at least one linked work item
 * whose type matches workItemType (case-insensitive).
 * Returns false when no links exist or none match the type.
 */
export async function checkPRLinkedToWorkItemType(
    repositoryId: string,
    pullRequestId: number,
    projectId: string,
    workItemType: string
): Promise<boolean> {
    const refs = await getClient(GitRestClient).getPullRequestWorkItemRefs(
        repositoryId,
        pullRequestId,
        projectId
    );
    if (refs.length === 0) {
        return false;
    }
    // Batch-fetch just the WorkItemType field for all linked items.
    const ids = refs.map(r => r.id).filter(Boolean).map(Number);
    if (ids.length === 0) {
        return false;
    }
    // Do not scope to a specific project — linked work items may live in a
    // different project from the PR (cross-project links).
    const workItems = await getClient(WorkItemTrackingRestClient).getWorkItems(
        ids,
        undefined,
        ["System.WorkItemType"]
    );
    const typeLower = workItemType.toLowerCase();
    return workItems.some(
        wi => (wi.fields?.["System.WorkItemType"] as string)?.toLowerCase() === typeLower
    );
}

export async function loadPullRequests(
    repos: GitRepository[],
    filterState: IFilterState,
    skip: number,
    take: number,
    explicitProjectId?: string
): Promise<{
    pullRequests: GitPullRequest[];
    responseCount: number;
}> {
    let projectId: string;
    if (explicitProjectId) {
        projectId = explicitProjectId;
    } else {
        const projectService = await getService<IProjectPageService>(CommonServiceIds.ProjectPageService);
        const project = await projectService.getProject();
        projectId = project!.id;
    }
    const queryCriteria = createQueryCriteria(repos, filterState);

    const pullRequests = await getClient(GitRestClient).getPullRequestsByProject(
        projectId,
        queryCriteria.criteria,
        undefined,
        skip,
        take
    );

    const displayPrs = pullRequests.filter(queryCriteria.localFilter);

    return {
        pullRequests: displayPrs,
        responseCount: pullRequests.length
    };
}
