import * as React from "react";
import * as ReactDOM from "react-dom";
import * as SDK from "azure-devops-extension-sdk";
import { GitPullRequest } from "azure-devops-extension-api/Git";

import * as Querying from "./Querying";

// ---------------------------------------------------------------------------
// Widget configuration shape – shared with WidgetConfig.tsx via this export
// ---------------------------------------------------------------------------

export interface IWidgetConfig {
    projectIds: string[];       // selected project IDs; [] = all projects
    status: string;             // status label e.g. "Active", "All", "Completed", …
    onlyMissingLinkType: boolean; // show only PRs NOT linked to workItemType
    workItemType: string;       // work item type to check, e.g. "Task"
    maxCount: number;           // max PRs to display (1–50)
}

export const WIDGET_CONFIG_DEFAULTS: IWidgetConfig = {
    projectIds: [],
    status: "Active",
    onlyMissingLinkType: false,
    workItemType: "",
    maxCount: 10,
};

// ---------------------------------------------------------------------------
// Minimal widget contract types
// (azure-devops-extension-api/Dashboard not included in v1 of the package;
//  these replicate the relevant interfaces from the upstream source)
// ---------------------------------------------------------------------------

interface WidgetSettings {
    name: string;
    customSettings: { data: string; version?: { major: number; minor: number; patch: number } };
    size: { columnSpan: number; rowSpan: number };
}

// statusType 0 = success, 1 = failure, 2 = unconfigured
const SUCCESS = { statusType: 0 };

// ---------------------------------------------------------------------------
// Direct statuses that map 1-to-1 with the REST API (no extra local filter)
// Sub-statuses (Draft, Rejected, etc.) require fetching more items upfront
// ---------------------------------------------------------------------------
const DIRECT_STATUSES = new Set(["Active", "Abandoned", "Completed", "All"]);

// ---------------------------------------------------------------------------
// PR list item helper components
// ---------------------------------------------------------------------------

function Avatar({ imageUrl, displayName }: { imageUrl?: string; displayName?: string }) {
    const [imgError, setImgError] = React.useState(false);
    const initial = displayName ? displayName[0].toUpperCase() : "?";
    if (!imgError && imageUrl) {
        return (
            <img
                src={imageUrl}
                alt={displayName ?? ""}
                title={displayName}
                onError={() => setImgError(true)}
                style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
            />
        );
    }
    return (
        <div title={displayName} style={{
            width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
            background: "#0078d4", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "12px", fontWeight: 600,
        }}>
            {initial}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface IWidgetState {
    loading: boolean;
    prs: GitPullRequest[];
    title: string;
    error?: string;
}

// ---------------------------------------------------------------------------
// Stable forwarder registered synchronously so the host probe never misses.
// ---------------------------------------------------------------------------
let _instance: PullRequestWidget | null = null;

const _widgetForwarder = {
    preload: (s: WidgetSettings) => _instance ? _instance.preload(s) : SUCCESS,
    load:    (s: WidgetSettings) => _instance ? _instance.load(s)    : SUCCESS,
    reload:  (s: WidgetSettings) => _instance ? _instance.reload(s)  : SUCCESS,
};

class PullRequestWidget extends React.Component<{}, IWidgetState> {
    constructor(props: {}) {
        super(props);
        this.state = { loading: true, prs: [], title: "Pull Requests Filtered" };
    }

    componentDidMount() { _instance = this; }
    componentWillUnmount() { _instance = null; }

    // Called by the framework before load() – fast-paint cached/skeleton state.
    async preload(_widgetSettings: WidgetSettings) {
        return SUCCESS;
    }

    // Called by the framework on initial load.
    async load(widgetSettings: WidgetSettings) {
        return this.doLoad(widgetSettings);
    }

    // Called by the framework when configuration changes (live preview).
    async reload(widgetSettings: WidgetSettings) {
        return this.doLoad(widgetSettings);
    }

    private async doLoad(widgetSettings: WidgetSettings) {
        this.setState({ loading: true, title: widgetSettings.name });
        try {
            const config: IWidgetConfig = widgetSettings.customSettings?.data
                ? { ...WIDGET_CONFIG_DEFAULTS, ...JSON.parse(widgetSettings.customSettings.data) }
                : WIDGET_CONFIG_DEFAULTS;

            // Resolve which projects to query. Empty selection = all projects.
            const allProjects = await Querying.loadProjects();
            const targetProjects = config.projectIds.length > 0
                ? allProjects.filter(p => config.projectIds.includes(p.id))
                : allProjects;

            // Build filter state (status only — repo filter is removed).
            const filterState: Record<string, { value: unknown }> = {};
            if (config.status && config.status !== "All") {
                filterState["status"] = { value: [config.status] };
            }

            // Fetch a larger batch when results will be further filtered client-side.
            const workItemTypeActive = config.workItemType.trim() !== "";
            const needsExtraFetch =
                (workItemTypeActive) || !DIRECT_STATUSES.has(config.status);
            const fetchCount = needsExtraFetch
                ? Math.min(100, config.maxCount * 5)
                : config.maxCount;

            // Fetch PRs from all target projects in parallel, then merge.
            const perProjectResults = await Promise.all(
                targetProjects.map(async project => {
                    const repos = await Querying.loadRepos(project.id);
                    const result = await Querying.loadPullRequests(
                        repos,
                        filterState as any,
                        0,
                        fetchCount,
                        project.id
                    );
                    return result.pullRequests;
                })
            );
            let prs = perProjectResults.flat();

            // Filter by work item type link.
            // Empty workItemType = no filtering.
            // onlyMissingLinkType checked  → keep PRs NOT linked to that type.
            // onlyMissingLinkType unchecked → keep PRs that ARE linked to that type.
            if (workItemTypeActive && prs.length > 0) {
                const hasTargetLink = await Promise.all(
                    prs.map(pr =>
                        Querying.checkPRLinkedToWorkItemType(
                            pr.repository.id,
                            pr.pullRequestId,
                            pr.repository.project.id,
                            config.workItemType.trim()
                        )
                    )
                );
                prs = config.onlyMissingLinkType
                    ? prs.filter((_, i) => !hasTargetLink[i])
                    : prs.filter((_, i) =>  hasTargetLink[i]);
            }

            const finalPrs = prs.slice(0, config.maxCount);

            this.setState({ loading: false, prs: finalPrs });
            return SUCCESS;
        } catch (e) {
            const msg = String(e);
            this.setState({ loading: false, error: msg });
            return Promise.reject({ message: msg, isUserVisible: true });
        }
    }

    private getPrUrl(pr: GitPullRequest): string {
        return pr.url
            .replace("/_apis/git/repositories/", "/_git/")
            .replace("/pullRequests/", "/pullrequest/")
            .replace(`/${pr.repository.id}/`, `/${pr.repository.name}/`)
            .replace(`/${pr.repository.project.id}/`, `/${pr.repository.project.name}/`);
    }

    render() {
        const { loading, prs, title, error } = this.state;

        return (
            <div style={{
                padding: "8px 12px",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                fontFamily: '"Segoe UI", Helvetica Neue, sans-serif',
            }}>
                <h3 style={{ margin: "0 0 8px 0", fontSize: "14px", fontWeight: 600, flexShrink: 0 }}>
                    {title}
                </h3>

                {loading && (
                    <div style={{ color: "#605e5c", fontSize: "13px" }}>Loading…</div>
                )}

                {!loading && error && (
                    <div style={{ color: "#a4262c", fontSize: "12px", wordBreak: "break-word" }}>
                        {error}
                    </div>
                )}

                {!loading && !error && prs.length === 0 && (
                    <div style={{ color: "#605e5c", fontSize: "13px" }}>
                        No pull requests found.
                    </div>
                )}

                {!loading && !error && prs.length > 0 && (
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", overflow: "auto", flex: 1 }}>
                        {prs.map(pr => (
                            <li
                                key={pr.pullRequestId}
                                style={{
                                    padding: "5px 0",
                                    borderBottom: "1px solid rgba(0,0,0,.07)",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                }}
                            >
                                <Avatar
                                    imageUrl={pr.createdBy?.imageUrl}
                                    displayName={pr.createdBy?.displayName}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <a
                                        href={this.getPrUrl(pr)}
                                        target="_blank"
                                        rel="noreferrer"
                                        title={pr.title}
                                        style={{
                                            display: "block",
                                            fontSize: "12px",
                                            fontWeight: 500,
                                            color: "var(--text-primary-color, #323130)",
                                            textDecoration: "none",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        !{pr.pullRequestId} {pr.title}
                                    </a>
                                    <div style={{ fontSize: "11px", color: "#605e5c", marginTop: "1px" }}>
                                        {pr.repository.name}
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        );
    }
}

// Register synchronously so the host's probe message never arrives before
// a handler exists. SDK.register just inserts into a map — init need not
// be complete first.
SDK.register("pr-search-widget", _widgetForwarder);
SDK.init();

ReactDOM.render(<PullRequestWidget />, document.getElementById("widget-root"));
