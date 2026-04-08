import * as React from "react";
import * as ReactDOM from "react-dom";
import * as SDK from "azure-devops-extension-sdk";
import { TeamProjectReference } from "azure-devops-extension-api/Core";

import { Dropdown } from "azure-devops-ui/Dropdown";
import { ListSelection } from "azure-devops-ui/List";
import { IListBoxItem } from "azure-devops-ui/ListBox";

import * as Querying from "./Querying";
import { IWidgetConfig, WIDGET_CONFIG_DEFAULTS } from "./Widget";
import { statusStrings } from "./Filtering";

// ---------------------------------------------------------------------------
// Minimal widget configuration contract types
// (mirrors azure-devops-extension-api/Dashboard which is not in v1)
// ---------------------------------------------------------------------------

interface WidgetSettings {
    name: string;
    customSettings: { data: string; version?: { major: number; minor: number; patch: number } };
}

const CONFIGURATION_CHANGE_EVENT = "ms.vss-dashboards-web.configurationChange";
const SUCCESS = { statusType: 0 };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface IConfigState {
    config: IWidgetConfig;
    projects: TeamProjectReference[];
    projectsLoaded: boolean;
}

// Stable forwarder registered synchronously.
let _configInstance: PullRequestWidgetConfig | null = null;

const _configForwarder = {
    load:   (s: WidgetSettings, ctx: any) => _configInstance ? _configInstance.load(s, ctx)   : SUCCESS,
    onSave: ()                            => _configInstance ? _configInstance.onSave()        : { customSettings: { data: "{}" }, isValid: false },
};

class PullRequestWidgetConfig extends React.Component<{}, IConfigState> {
    private widgetConfigContext?: {
        notify: (event: string, args: { data: unknown }) => Promise<unknown>;
    };

    // Persistent ListSelection instance so Dropdown can track checked state.
    private readonly projectSelection = new ListSelection({ multiSelect: true });

    constructor(props: {}) {
        super(props);
        this.state = { config: WIDGET_CONFIG_DEFAULTS, projects: [], projectsLoaded: false };
    }

    componentDidMount() {
        _configInstance = this;
        SDK.resize(440, 420);
    }

    componentWillUnmount() { _configInstance = null; }

    async load(widgetSettings: WidgetSettings, widgetConfigContext: typeof this.widgetConfigContext) {
        this.widgetConfigContext = widgetConfigContext;

        const config: IWidgetConfig = widgetSettings.customSettings?.data
            ? { ...WIDGET_CONFIG_DEFAULTS, ...JSON.parse(widgetSettings.customSettings.data) }
            : WIDGET_CONFIG_DEFAULTS;

        try {
            const projects = await Querying.loadProjects();
            // Restore previously saved project selection onto the ListSelection.
            projects.forEach((p, i) => {
                if (config.projectIds.includes(p.id)) {
                    this.projectSelection.select(i, 1, true, true);
                }
            });
            this.setState({ config, projects, projectsLoaded: true });
        } catch {
            this.setState({ config, projectsLoaded: true });
        }

        return SUCCESS;
    }

    async onSave() {
        return {
            customSettings: this.buildCustomSettings(this.state.config),
            isValid: true,
        };
    }

    private buildCustomSettings(config: IWidgetConfig) {
        return {
            data: JSON.stringify(config),
            version: { major: 1, minor: 0, patch: 0 },
        };
    }

    private updateConfig(partial: Partial<IWidgetConfig>) {
        const config = { ...this.state.config, ...partial };
        this.setState({ config });
        this.widgetConfigContext?.notify(CONFIGURATION_CHANGE_EVENT, {
            data: this.buildCustomSettings(config),
        });
    }

    private onProjectSelectionChanged = () => {
        const { projects } = this.state;
        const selectedRanges = this.projectSelection.value;
        const selectedIds: string[] = [];
        for (const range of selectedRanges) {
            for (let i = range.beginIndex; i <= range.endIndex; i++) {
                if (projects[i]) selectedIds.push(projects[i].id);
            }
        }
        this.updateConfig({ projectIds: selectedIds });
    };

    render() {
        const { config, projects, projectsLoaded } = this.state;

        const fieldStyle: React.CSSProperties = { marginBottom: "16px" };
        const labelStyle: React.CSSProperties = {
            display: "block",
            fontWeight: 600,
            fontSize: "13px",
            marginBottom: "4px",
            color: "#323130",
        };
        const selectStyle: React.CSSProperties = {
            width: "100%",
            padding: "5px 8px",
            fontSize: "13px",
            border: "1px solid #8a8886",
            borderRadius: "2px",
            background: "#ffffff",
        };
        const inputStyle: React.CSSProperties = {
            width: "100%",
            padding: "5px 8px",
            fontSize: "13px",
            border: "1px solid #8a8886",
            borderRadius: "2px",
            boxSizing: "border-box",
        };

        const projectItems: IListBoxItem[] = projects.map(p => ({
            id: p.id,
            text: p.name,
        }));

        const selectedCount = config.projectIds.length;
        const projectPlaceholder = !projectsLoaded
            ? "Loading projects…"
            : selectedCount === 0
            ? "All projects"
            : `${selectedCount} project${selectedCount !== 1 ? "s" : ""} selected`;

        return (
            <div style={{ padding: "16px 20px", fontFamily: '"Segoe UI", Helvetica Neue, sans-serif' }}>

                {/* Projects multi-select */}
                <div style={fieldStyle}>
                    <label style={labelStyle}>Projects</label>
                    <Dropdown
                        placeholder={projectPlaceholder}
                        items={projectItems}
                        selection={this.projectSelection}
                        onSelect={this.onProjectSelectionChanged}
                        disabled={!projectsLoaded}
                        showFilterBox
                        filterPlaceholderText="Filter projects…"
                    />
                    <div style={{ fontSize: "11px", color: "#605e5c", marginTop: "4px" }}>
                        Leave empty to include all projects.
                    </div>
                </div>

                {/* Status */}
                <div style={fieldStyle}>
                    <label style={labelStyle}>Status</label>
                    <select
                        value={config.status}
                        onChange={e => this.updateConfig({ status: e.target.value })}
                        style={selectStyle}
                    >
                        {statusStrings.map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </div>

                {/* Linked work item type */}
                <div style={fieldStyle}>
                    <label style={labelStyle}>Linked work item type</label>
                    <input
                        type="text"
                        value={config.workItemType}
                        onChange={e => this.updateConfig({ workItemType: e.target.value })}
                        placeholder="e.g. Task (leave empty to skip)"
                        style={inputStyle}
                    />
                    <div style={{ fontSize: "11px", color: "#605e5c", marginTop: "4px" }}>
                        Leave empty to skip this filter.
                    </div>
                </div>

                {/* Only missing link type */}
                <div style={{ ...fieldStyle, paddingLeft: "22px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px",
                        color: config.workItemType.trim() ? "#323130" : "#a19f9d" }}>
                        <input
                            type="checkbox"
                            checked={config.onlyMissingLinkType}
                            onChange={e => this.updateConfig({ onlyMissingLinkType: e.target.checked })}
                            disabled={!config.workItemType.trim()}
                            style={{ width: "14px", height: "14px", cursor: config.workItemType.trim() ? "pointer" : "default" }}
                        />
                        <span>Show PRs <strong>not</strong> linked to this type (uncheck to show only PRs <strong>that are</strong> linked)</span>
                    </label>
                </div>

                {/* Max count */}
                <div style={fieldStyle}>
                    <label style={labelStyle}>Max pull requests to show</label>
                    <input
                        type="number"
                        min={1}
                        max={50}
                        value={config.maxCount}
                        onChange={e => {
                            const v = parseInt(e.target.value, 10);
                            this.updateConfig({ maxCount: isNaN(v) ? 10 : Math.max(1, Math.min(50, v)) });
                        }}
                        style={{ width: "80px", padding: "5px 8px", fontSize: "13px", border: "1px solid #8a8886", borderRadius: "2px" }}
                    />
                </div>

            </div>
        );
    }
}

SDK.register("pr-filtered-widget-config", _configForwarder);
SDK.init();

ReactDOM.render(<PullRequestWidgetConfig />, document.getElementById("widget-root"));

