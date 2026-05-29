ThinkingData (Agentic Engine) — Comprehensive Feature Mapping for Game Ops
Platform: ThinkingData / Agentic Engine (AE) v6.0 | Instance: thinkingdata-web.vnggames.net | Scope: Analytics · Real-time Tracking · Engagement/Activation

Overview
ThinkingData's Agentic Engine (AE) is a full-stack player intelligence and operations platform organized into five top-level modules:
ModulePurposeAnalyticsBehavioral analysis across 9 analysis modelsUsersAudience segmentation via Tags, Cohorts, and User Look-UpEngageTargeted push operations via tasks, journeys, and campaignsConfig CenterLive remote configuration delivery without re-deploying app buildsData (DataOps)Event/property management, tracking governance, real-time monitoring

FILE 1 — ANALYTICS MODULE
1.1 Events Analysis
What it is: A flexible, multi-metric analysis model for quantifying user behaviors over time using aggregations, filters, group-bys, and formulas.
Required Inputs:

One or more events (preset, custom, or virtual) to analyze
Calculation method: Event Totals, Unique Users, Times per User, or a numerical event property (sum, avg, max, etc.)
Time range and granularity (hourly, daily, weekly, monthly, total)
Optional: Data filters (event property, user property, tag, cohort), Group-by dimensions, Formula expressions (A+B, A/B, etc.)

Expected Outputs:

Line/bar/stacked/pie/cumulative trend charts
Data table with metric values per time period and per group
Comparison view (e.g., this month vs. last month, channel A vs. channel B)
Drill-down to User List for any data point

Business Impact for Game Ops:

Monitor DAU/WAU/MAU and login trends across servers or regions
Measure payment conversion rate (paying users ÷ active users) by day
Track per-user ARPU, session count, or feature engagement trends
Identify spike/drop anomalies in any tracked in-game behavior (battle starts, item purchases, dungeon clears)
Compare cross-channel performance (iOS vs. Android, country-level)


1.2 Retention Analysis
What it is: Cohort-based analysis measuring how many users who completed a "First Event" (trigger) also come back to complete a "Return Event" on Day N, Week N, or Month N.
Required Inputs:

Entity type: User, Device, Role, or custom entity
First Event (e.g., register, app_launch, first_payment)
Return Event (e.g., login, session_start)
Granularity: Daily / Weekly / Monthly
Optional: "Calculate another metric" (e.g., LTV revenue), "Hold Property Constant" (retain users only if same property value), Data filters, Group-by

Expected Outputs:

Retention heatmap table: each cell = retained users / retention rate on Day N from a cohort date
"Day N Retention" line chart: tracks how Day-2/Day-7 retention evolved across cohort dates
"Daily Retention" line chart: compare cohorts' lifecycle curves side by side
Churn count and churn rate mirror views

Business Impact for Game Ops:

Track D1/D2/D7/D30 retention — the primary health KPI for any live game
Segment retention by channel to evaluate UA quality (does paid traffic retain better than organic?)
Measure LTV accumulation (enable "Calculate another metric" = revenue) for ROI break-even analysis
Use "Hold Property Constant" to compare retention across servers, game modes, or activity types
Identify which content updates (new dungeons, events, seasonal patches) improved or hurt retention


1.3 Funnel Analysis
What it is: Ordered step-by-step conversion analysis that shows how many users complete each successive step and where they drop off.
Required Inputs:

Entity type (User, Device, Role, etc.)
Ordered funnel steps (2–30 events; up to 30 steps supported by default)
Conversion Window: time limit (1 min to 180 days) within which all steps must complete
Optional: "Hold Property Constant" (e.g., product_id must match across steps), Data filters, Group-by

Expected Outputs:

Conversion Bar Chart: number and % completing each step per group
Trend Line Chart: daily conversion rate for any step-pair
Step-level drill-down to User List for converters or churners at each step
Churn rate per step

Business Impact for Game Ops:

Map new-user onboarding funnel: Install → Register → Tutorial Complete → First Login → First Purchase
Identify the step with the highest drop-off to prioritize game design improvements
Compare funnel performance across server regions, platform (iOS/Android), or acquisition source
Validate that seasonal event registration → participation → completion funnel works efficiently
Test A/B changes: did the new UI improve registration→payment conversion?


1.4 Retention by Interval Analysis
What it is: Measures the elapsed time between any two events for users, revealing how long conversions take or how quickly users return to a behavior.
Required Inputs:

Entity type
Starting Event (e.g., register)
Ending Event (e.g., first_purchase)
Upper time limit for interval (1 min to 180 days)
Optional: "Hold Property Constant" (starting and ending events share the same property value — e.g., same episode), numeric property difference (e.g., episode number must increase by 1), Data filters, Group-by

Expected Outputs:

Box-plot: min / lower quartile / median / upper quartile / max per date or total
Histogram: user distribution across time-range buckets (custom or equal intervals)
Table with count, mean, N-th percentile columns
Click-through to User List for specific time-range buckets

Business Impact for Game Ops:

Measure average time-to-first-purchase to optimize early monetization nudges
Diagnose slow content progression (if episode 1→2 takes users 3x longer than expected, something is wrong)
Detect installation package performance issues (slow app launch → first real interaction)
Tune push notification timing: if median time-to-re-engage after churn is 4 days, schedule win-back push at Day 3


1.5 Distribution Analysis
What it is: Segments users by how much or how often they performed an event (e.g., number of login days, payment amount), then shows how many users fall into each defined range.
Required Inputs:

Entity and event to aggregate
Aggregation type: number of times, days active, hours, or event property (with optional formula: e.g., diamonds acquired – diamonds spent)
Range definitions (custom or equal-interval buckets)
Optional: "Calculate another metric" (Also Show — e.g., avg revenue per bucket), Data filters, Group-by

Expected Outputs:

Stacked/Percentage Distribution trend chart by date
Histogram (when "Total" granularity selected)
Line/bar chart for "Also Show" metrics per range
Drill-down to User List or save bucket as Result Cohort

Business Impact for Game Ops:

Segment players by payment tier (0–$5, $5–$20, $20–$100, $100+) and analyze their behavior
Analyze virtual currency health: is diamond stockpile growing out of control (production > consumption)?
Identify highly active users vs. at-risk casual users by login-day distribution
Feed bucket outputs directly into Cohorts for targeted Engage campaigns (e.g., target "low-spend, high-activity" users for conversion)


1.6 Flows Analysis (Path / Sankey)
What it is: Exploratory, session-based analysis that displays user behavioral sequences as a Sankey diagram, showing which paths users take between any events.
Required Inputs:

Up to 30 meta events to include as nodes
Session interval: max gap between events before a new session starts (1 sec to 24 hrs)
First Event (session entry point) or Last Event (session exit point, for churn analysis)
Optional: Event Breakdown (split one event by a property value), User filters (property, tag, cohort)

Expected Outputs:

Sankey diagram: up to 10 steps forward from First Event (or backward from Last Event)
Each node shows session count; connecting lines show transition percentages
Node detail panel: distribution of next steps, "churn" if no next step
Drill-down to User List or save as Result Cohort from any node

Business Impact for Game Ops:

Discover the most common user journey from registration to purchase
Find what players do immediately before churning (identify the "last event before quit")
Reveal unexpected popular paths: e.g., 44% of new users go directly to "Challenge Resource Dungeon" after tutorial
Optimize game UI by seeing where players navigate vs. where you intended them to go
Identify which gameplay modes act as "sticky" nodes that keep users in-session


1.7 Composition Analysis (User Property Analysis)
What it is: A user-centered analysis that aggregates and compares user properties or tags across dimensions, enabling persona profiling and user group benchmarking.
Required Inputs:

Analysis metric: User count (distinct #user_id), user property, or user tag value
Optional: Data filters (user property, tag, cohort), Group-by (up to 2 dimensions), Up to 10 user groups for side-by-side comparison
Entity: AE User ID (note: timezone does not apply)

Expected Outputs:

Bar chart / Pie chart / Stacked bar (for 2 group-by items) comparing user counts or metrics across dimensions
Cross-tab table for intersection of 2 group-by dimensions
Drill-down to User List or save as Result Cohort

Business Impact for Game Ops:

Profile player base: country/region distribution, device type, VIP tier breakdown
Compare average payment per user across server regions or acquisition channels
Identify demographic overlaps: e.g., "How many high-payment users are also top-10% active?"
Generate user group comparison to benchmark churned users vs. retained users
Provides the data foundation for creating targeted Cohorts for Engage campaigns


1.8 Attribution Analysis
What it is: Multi-touch attribution that assigns conversion credit (e.g., purchase value) across user-triggered touchpoint events based on a chosen attribution model.
Required Inputs:

Entity type
Attribution Model: First Click, Last Click, or Linear
Attribution Window: Same Day or Custom (day/hour/minute)
Conversion Event (e.g., purchase) + Goal Metric (e.g., payment amount)
Touchpoints: 1+ events (e.g., click_ad, open_event_banner, view_item)
Optional: "Include direct conversions" (organic traffic), Group-by on touchpoints or conversion event, "Hold Property Constant" (e.g., session_id must match), Data filters

Expected Outputs:

Attribution result table per touchpoint:

Times Triggered (total)
Valid Trigger Times (attributed)
Valid Rate (%)
Valid Trigger Users
Conversion Value
Percentage of Total Conversion Value



Business Impact for Game Ops:

Measure which in-game promotion surface (pop-up, icon, banner, campaign page) drives the most recharge
Determine if a "skin limited-time discount" entry point or "marketplace purchase" triggers more diamond spending
Evaluate which content touchpoints lead players to character/role cultivation actions
Inform where to invest UI/UX improvements based on conversion contribution
Distinguish organic conversions from promoted ones to assess true lift from campaigns


1.9 Leaderboard (Scenario Feature)
What it is: Generates ranked user lists based on any metric (event totals, user property, etc.) for a defined time window.
Required Inputs:

Entity and leaderboard scope (e.g., "att" entity)
Sort-by metric: event totals, unique users, or property value — Ascending or Descending
Optional: Also Show additional metrics, Filters (all events meet conditions), Tie-breaking rule, Time range, VS comparison

Expected Outputs:

Ranked user list with metric value per entity
Comparative leaderboard (VS mode: e.g., this week vs. last week)

Business Impact for Game Ops:

Generate live server/guild/event leaderboards for display or export
Identify top-spending, top-active, or top-performing players for VIP treatment
Use leaderboard cohort outputs to feed back into Engage for exclusive rewards targeting
Compare server health rankings (e.g., which server has highest top-100 spend this week)


1.10 Heatmap (Scenario Feature)
What it is: Plots event intensity or user property values against two coordinate axes (X/Y properties) on a selectable map file, creating spatial density visualizations.
Required Inputs:

Heat Event (e.g., af_login)
Calculate: Event Totals or another aggregation
X-axis property (numeric coordinate, e.g., total_purchased_count)
Y-axis property (numeric coordinate)
Map file: upload/select a background map image
Optional: Multi-group Comparison

Expected Outputs:

Heatmap overlay on selected map background
Density gradient showing where events cluster

Business Impact for Game Ops:

Visualize in-game player location density (e.g., which map zones see the most combat events)
Identify "dead zones" in game world where players rarely venture
Analyze spatial patterns in event interactions (e.g., resource collection clustering around spawn points)
Compare heatmaps across time windows to measure impact of new content on player movement


1.11 SQL IDE
What it is: A full SQL query editor with access to the project's raw data tables, supporting ad-hoc analysis beyond what the model-based tools provide.
Required Inputs:

SQL query (SELECT statements against project tables)
Optional: Dynamic parameters (for parameterized queries)

Available Tables:
TableDescriptionta.v_event_12Event Table (all raw event data)ta.v_user_12User Property Tableta.user_result_cluster_12Tag and Cohort Tableta.history_tag_12Historical Tag Tableta.user_day_serial_12User Snapshot Fact Table
Expected Outputs:

Query result set (table)
Query History, Bookmarks for saved queries
Visualization of results (chart)

Business Impact for Game Ops:

Answer any complex analytical question not covered by standard models
Build custom LTV, ARPU, or segment calculations with arbitrary logic
Combine event + user property + tag data in custom joins
Power advanced reporting pipelines or export-ready datasets


1.12 Dashboard
What it is: A composable reporting layer where saved analysis reports are pinned into shared or personal dashboards.
Required Inputs:

Reports/charts saved from any analytics model
Dashboard name, folder (My Space / Team Space / Shared with Me)

Expected Outputs:

Multi-panel dashboard with auto-refresh
Sharable across team members
Export/download as reports
Mobile-compatible view

Business Impact for Game Ops:

Create daily ops monitoring dashboards (DAU, revenue, new users, D1 retention)
Share real-time game health KPIs with producers and studio leadership
Build event-specific dashboards (e.g., "Season Pass Launch Week" metrics)
Enable non-technical team members to self-serve on prebuilt reports


FILE 2 — USERS MODULE (Segmentation & Player Intelligence)
2.1 Tags
What it is: A pre-computation label system that assigns rule-based or imported property values to each user entity. Tags are reusable across analytics, cohorts, and engage targeting.
Tag Types:
Tag TypeDefinition MethodUse CaseID TagImport file mapping user IDs to tag valuesOffline marketing lists, 3rd-party credit scoresBehavioral TagRule: user has/has not done event(s)VIP level, churned player flag, active player flagFirst/Last TagCapture event property at first or last occurrenceFirst purchase item, last active level, registration countryMetric Value TagAggregate event property over time periodTotal spend last 30 days, login days last weekSQL TagCustom SQL logicComplex multi-condition labels
Required Inputs:

Tag type selection
User entity (User ID, Device, Role ID, etc.)
Tag definition rules (event conditions, property selectors, time ranges)
Timezone
Update mode: Auto (daily), Manual, or on-create/on-edit

Expected Outputs:

Tag values assigned per user entity (updated at configured frequency)
Tag detail view: list of users per tag value per date
Historical tag data (past dates queryable via "Dates of Tag")
Drill-down to User List or export (up to 500K rows)

Business Impact for Game Ops:

Create reusable player segments: "High Spender", "Re-engaged User", "Active 7 of Last 7 Days"
Label players by acquisition channel for persistent cross-analysis
Tag-based VIP stratification for personalized reward tiers
Historical tag data enables analyzing "what was a user's tag value when they made this purchase?"
Tags flow directly into Cohorts for Engage targeting


2.2 Cohorts
What it is: A user group (saved filter set) that defines a list of user entities meeting specific conditions at a point in time. Cohorts are the primary targeting unit for Engage operations.
Types of Cohorts:

Rule-based Cohort: Define conditions (event behavior, user property, tag value, or combinations); auto-recalculated on schedule
Result Cohort: Saved directly from an analysis model result (e.g., "Users who churned at Step 3 of onboarding funnel")

Required Inputs:

Cohort name
Entity type
Condition rules (event behavior, property filter, tag value, or imported ID list)
Update schedule (daily auto-update or manual)

Expected Outputs (from live platform):

Cohort list with entity type and cohort type (Result Cohort visible)
User count per cohort
Cohort available for use in: analytics filters, tag definitions, engage audience targeting

Business Impact for Game Ops:

"Churned users in last 14 days" cohort → target with re-engagement push campaign
"Users who completed payment in last 7 days but haven't logged in 3 days" → retention nudge
"All users who cleared Episode 10 but haven't started Episode 11" → story progression campaign
"Top 500 spenders this month" → exclusive in-game reward or loyalty program
Cohort feeds directly into Engage Operation Tasks as audience filter


2.3 User Look-Up
What it is: An individual user search and inspection tool that surfaces a specific user's properties, events, tags, and behavioral timeline.
Required Inputs:

Filter condition (user property + operator + value, e.g., first_attr_campaign is [value])
Click "Filter" to query

Expected Outputs:

List of users matching filter
Per-user detail: all user properties, tag values, event history, behavior sequence

Business Impact for Game Ops:

Investigate a specific player complaint or VIP support case
Verify data collection quality for a single test user
Deep-dive on a whale player's journey to inform VIP strategy
Confirm that a specific player received and converted on an Engage campaign


FILE 3 — ENGAGE MODULE (Activation, Retention, Monetization)
3.1 Operation Tasks
What it is: The primary delivery mechanism for personalized, targeted content and incentives pushed to specific user cohorts via configured channels.
Task Types:
Task TypeTrigger MechanismBest ForTimed TaskScheduled at fixed date/timeEvents, weekly rewards, limited-time offersTriggered TaskFires when user performs a specific behavior (server-side event)Real-time responses to in-game actionsClient-Triggered TaskTriggered by AE SDK conditions on-deviceIn-app pop-ups, overlays within the game client
Required Inputs:

Audience: Cohort selection or tag-based filter
Push Timing: Timed (scheduled datetime) / Triggered (on event condition) / Client-triggered (SDK parameter condition)
Channel: Webhook / Push Notification (JPush, FCM, APNs) / Client Channel (in-app via SDK)
Content Template: message text, image, deep link, or custom parameters
Conversion Target: event to measure post-push success (e.g., purchase within 24 hours)
Optional: A/B Test groups, Whitelist users, Localization (multi-language by user language property), Delivery Cap settings

Expected Outputs:

Task published and executed per schedule/trigger
Task Effect Analysis dashboard:

Reach data (delivered, opened, clicked)
Conversion Rate per day or per push
Funnel: push → conversion event
User loss analysis (who received but didn't convert)


A/B test winner identification

Business Impact for Game Ops:

Send targeted in-game or push notifications when players complete specific milestones
Re-engage churned users: fire triggered task when a user hasn't logged in for 3 days
Deliver personalized promotional offers to high-value cohorts (e.g., "30-day whale" cohort)
Run A/B tests on reward messaging to maximize conversion to payment
Track full funnel from push delivery → click → game action → purchase in one view


3.2 Journey (User Journey Orchestration)
What it is: A visual, drag-and-drop flow builder that sequences multiple engagement steps (branches, delays, conditions, messages) into an automated user lifecycle journey.
Required Inputs:

Entry Conditions: cohort membership, event trigger, or schedule
Flow components: Branch nodes, Delay nodes, Push/Message nodes, Exit conditions
Branching strategies: e.g., split by tag value, A/B split, behavior filter
Conversion goal events

Expected Outputs:

Active journey executing in real-time across enrolled users
Journey Analysis: node-level performance, conversion at each step, drop-off rates
Version control / approval workflow for governance

Business Impact for Game Ops:

Build automated new user onboarding journeys: Day 0 welcome → Day 1 tutorial nudge → Day 3 first-purchase offer → Day 7 retention reward
Create seasonal event participation funnels automatically (enter → play → reward)
Automate win-back journeys for at-risk players without manual campaign management
Branch journeys based on player behavior: "If user made a purchase → path A (loyalty reward); if not → path B (discount offer)"


3.3 Campaigns
What it is: A container that groups multiple related Operation Tasks under a single thematic campaign for batch management and consolidated performance reporting.
Required Inputs:

Campaign name and theme
Multiple Operation Tasks (shared target audience and/or push timing)
Independent tasks (flexible combinations within same campaign)

Expected Outputs:

Campaign-level Effect Analysis: aggregated metrics across all constituent tasks
Campaign Management tools: approve, pause, finish, delete, edit
Consolidated reporting view for ops specialist

Business Impact for Game Ops:

Manage "Summer Festival Event" as one campaign with sub-tasks for push, in-app, and email
Compare multiple concurrent promotion campaigns to identify best performers
Streamline approval workflow for complex multi-channel ops efforts
Enable team-level operational planning with visibility into all active campaigns


3.4 Engage Workspace
What it is: A global monitoring dashboard for the entire Engage module, providing cross-task KPI visibility and scheduling.
Key Components:

Operation Key Metrics: 4 metric cards monitoring: daily task count, push performance (delivery, CTR), and active player indicators
Schedule Chart: Gantt chart view of all running operation tasks by date

Required Inputs:

No setup required; auto-aggregates from all active tasks in the project

Expected Outputs:

Daily snapshot of campaign execution health
Visual scheduling conflicts or gaps in push calendar
Active/new user and revenue metrics at operations level

Business Impact for Game Ops:

Prevent push frequency overload (fatigue control) by seeing full campaign calendar
Monitor daily operations at a glance without digging into individual tasks
Communicate campaign pipeline to game producers and live ops leadership


FILE 4 — CONFIG CENTER (Live Remote Configuration)
4.1 Config Items & Templates
What it is: A remote configuration delivery system that lets game ops modify in-game content, UI parameters, and activity rules without requiring a new app build or version release.
How It Works:

Config Item = a business module in the game (e.g., "Daily Login Bonus", "Push Pop-up Banner")
Config Template = a set of parameters for that module (e.g., {reward_type: gold, reward_amount: 500})
Config Parameter = individual variables reusable across templates
Config Strategy = a specific active combination of item + template values deployed to users

Delivery Channels:

Webhook Channel: Game server polls ThinkingData for config values
AE SDK Pull: Client SDK periodically fetches latest config at startup or interval

Required Inputs:

Config Item definition (module name, integration channel)
Config Template parameters (name, data type, default values)
Config Strategy: which template values are active for which user cohort
Strategy targeting: All users, specific cohort, or condition-based (tag value, user property)

Expected Outputs:

Config values delivered to game client/server without app store re-release
Strategy Data Analysis: track how different configs affect player behavior

Business Impact for Game Ops:

Change in-game event reward amounts in real-time without code deployment
Run configuration A/B tests: "Does offering 500 gold vs. 1000 gold at Day 3 improve retention?"
Tailor activity content to player segments (new players see Tutorial bonus, veterans see Season Pass offer)
Enable rapid response to server economy imbalances (adjust drop rates, reward caps) without dev team bottleneck


FILE 5 — DATA MANAGEMENT (DataOps)
5.1 Events & Event Properties Management
What it is: The schema registry for all game events being tracked. Provides visibility and governance over what events are flowing into the system.
From Live Platform (171 events tracked):

Tabs: Registered Events, Reported Events, Cross-Origin Events
Columns: Event Name, Display Name, Description, Event Data Type, Volume Yesterday, Real-time Available Status, Connection Status, Data Status

Event Types Observed (VNG Games instance):

af_login, af_purchase — AppsFlyer attribution events
app_launch, authentication — lifecycle events
cfl_* events — game-specific custom events (registration, login, purchase funnel)

Required Inputs:

SDK/API data reporting (automatic from game client/server)
Optional: Manual display name + description annotation

Expected Outputs:

Complete event catalog with metadata
"Volume yesterday" — daily event count per event name
Real-time availability status per event
Data status (Normal / Error)

Business Impact for Game Ops:

Verify all critical game events are reporting correctly before launching analysis
Detect broken event pipelines early (Data Status = Error)
Understand which events are available for real-time analysis vs. batch
Maintain clean naming and documentation for team-wide alignment


5.2 Tracking Plan & Validation
What it is: A governance layer for planned vs. actual event tracking, ensuring SDK instrumentation matches the analytical intent.
Tracking Plan:

Define expected events, their required properties, and acceptable value ranges
Acts as a contract between data/game engineering and analytics

Validation:

Real-time check of incoming event data against Tracking Plan rules
Surfaces property type mismatches, missing required fields, out-of-range values

Required Inputs:

Planned event definitions (from product/analytics team)
Validation rules per property

Expected Outputs:

Compliance report: which events match/violate the plan
Data quality alerting

Business Impact for Game Ops:

Prevent analytics errors caused by SDK instrumentation bugs
Ensure new feature tracking is correct before a game update goes live
Reduce root-cause investigation time when dashboards show anomalies


5.3 Real-Time Data Monitor
What it is: A live stream of the last 1,000 data records received by the platform, shown with Receive Time and raw data payload.
Two Views:

Real-time saved data: Successfully ingested events
Data with error: Failed/rejected events

Required Inputs:

No configuration; auto-streams incoming data

Expected Outputs:

Live event stream with timestamps
Downloadable data log

Business Impact for Game Ops:

Verify that a newly launched in-game event is firing and being received correctly
Debug SDK integration issues during development or post-patch
Confirm real-time triggers for Engage tasks are firing as expected


5.4 Debugger
What it is: A device-level event debugger enabling per-device event stream inspection for QA and development validation.
Required Inputs:

Device ID or test user identifier

Expected Outputs:

Per-device event log in real-time
Property-level detail for each event

Business Impact for Game Ops:

QA team validates tracking is correct before a game update release
Developers test SDK integration events without polluting production data
Confirm that triggered Engage conditions will fire on a test device


5.5 Product Metrics & Currency
Product Metrics:

Define custom calculated KPIs (e.g., "ARPU = revenue / active users") once and reuse across all analytics models
Provides business-standard metric definitions for consistency across team

Currency:

Configure in-game virtual currency mappings (e.g., "Diamond = $0.01") so payment analyses display in real-money equivalent automatically
Required Input: currency name, conversion rate, base currency
Expected Output: revenue metrics normalized to real currency in all analysis models

Business Impact for Game Ops:

Enforce consistent KPI definitions across all analyst reports
View in-game economy health in real-dollar equivalents without manual conversion
Enable accurate LTV and ARPU calculations using real-money denominators


SUMMARY MATRIX: Feature → Game Ops Use Case
FeaturePrimary Use in Game OpsKey InputsKey OutputEvents AnalysisDaily KPI monitoring, feature usage trackingEvents, filters, group-byTrend charts, tablesRetention AnalysisD1/D7/D30 health, LTV cohort trackingFirst/Return event, entityRetention heatmap + curvesFunnel AnalysisOnboarding conversion, payment flow drop-offOrdered steps, conversion windowConversion bar + trendInterval AnalysisTime-to-purchase, progression speedStart/end events, time limitBox-plot, histogramDistribution AnalysisPlayer spend tiers, activity level segmentationEvent + aggregation + rangesRange bucket chart + user listFlows AnalysisPlayer journey discovery, churn path detectionEvent set, session intervalSankey diagramComposition AnalysisPlayer persona profiling, group benchmarkingUser properties, tags, cohortsBar/pie comparisonAttribution AnalysisIn-game promotion ROI, surface contributionTouchpoints, conversion, modelConversion value per touchpointLeaderboardServer rankings, whale identificationSort metric, entityRanked user listHeatmapSpatial player behavior, map zone analysisX/Y coordinate properties, map fileSpatial density heatmapSQL IDECustom calculations, ad-hoc deep divesSQL queryRaw result setDashboardLive ops monitoring, stakeholder reportingSaved reportsMulti-panel shared dashboardTagsPersistent player labeling, reusable segmentsTag rules, entity, update schedulePlayer label valuesCohortsAudience targeting for campaignsRule conditions or analysis resultsUser group for EngageUser Look-UpIndividual player investigation, VIP supportProperty filtersSingle user profile + timelineOperation Tasks (Timed)Scheduled promotions, event announcementsCohort, content, schedulePush delivery + conversion reportOperation Tasks (Triggered)Real-time behavior-based responsesEvent trigger, cohort, contentInstant push on player actionOperation Tasks (Client)In-app overlays and pop-upsSDK conditions, content templateIn-game UI content deliveryJourneyAutomated lifecycle onboarding/retentionEntry condition, flow nodesAutomated multi-step campaignCampaignsThemed multi-task ops managementMultiple tasks, campaign goalUnified campaign reportConfig CenterLive game content changes without deployConfig items/templates/strategiesRemote config to game clientReal-time DataSDK/event pipeline health monitoringAuto-streamsLive event logTracking Plan / ValidationData quality governancePlanned event schemaCompliance + error reportsDebuggerQA testing, SDK integration validationDevice IDPer-device event streamProduct Metrics / CurrencyKPI standardization, revenue normalizationMetric formula, currency rateConsistent KPIs across all models

Architecture Note: How the Modules Connect
DATA LAYER (Events, Properties, Real-time, Debugger)
        ↓
ANALYTICS (Events/Retention/Funnel/Flows/Heatmap/Attribution/SQL)
        ↓
USERS (Tags ← Analytics results + raw data)
USERS (Cohorts ← Tag values + analytics result cohorts)
        ↓
ENGAGE (Tasks/Journey/Campaigns ← Cohort as audience + event as trigger)
        ↓
CONFIG CENTER (Strategy targeting ← Cohort/tag conditions)
        ↓
EFFECT ANALYSIS ← feeds back into Analytics (closed loop)
The platform is designed as a closed-loop: raw event data → analytical insight → user segmentation → targeted action → effect measurement → refined segmentation → next campaign. This is the core feedback loop for data-driven game operations.