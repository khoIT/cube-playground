/* global React, ReactDOM, TweaksPanel, TweakSection, TweakRadio, TweakToggle, useTweaks,
   NavProvider, useNav, AppShell, GlobalSearchProvider, ToastProvider,
   CatalogPage, MetricDetailPage, ExplorePage, WizardPage,
   SavedViewsPage, DigestPage, NotificationsPage, WorkspacesPage,
   SubscribeModal, SaveViewModal, ChangeAnalysisModal,
   CONCEPT_BY_ID */
/* Compass app entry. Wires routing, tweaks, modals, and the app shell. */

const { useState: useStateApp } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "trustProminence": "medium",
  "chipPlacement": "bottom",
  "editStyle": "inline",
  "searchFraming": "smart"
}/*EDITMODE-END*/;

function CompassApp() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [sidebarCollapsed, setSidebarCollapsed] = useStateApp(false);
  const [subscribeOpen, setSubscribeOpen] = useStateApp(false);
  const [subscribeConcept, setSubscribeConcept] = useStateApp(null);
  const [saveViewOpen, setSaveViewOpen] = useStateApp(false);
  const [changeAnalysisOpen, setChangeAnalysisOpen] = useStateApp(false);
  const [changeAnalysisConcept, setChangeAnalysisConcept] = useStateApp("revenue.total_vnd");

  const openSubscribe = (concept) => { setSubscribeConcept(concept); setSubscribeOpen(true); };
  const openSaveView = () => setSaveViewOpen(true);
  const openChangeAnalysis = (id) => { if (id) setChangeAnalysisConcept(id); setChangeAnalysisOpen(true); };

  return (
    <ToastProvider>
      <NavProvider initial={{ name: "catalog" }}>
        <GlobalSearchProvider>
          <Router
            tweaks={tweaks}
            sidebarCollapsed={sidebarCollapsed} setSidebarCollapsed={setSidebarCollapsed}
            openSubscribe={openSubscribe}
            openSaveView={openSaveView}
            openChangeAnalysis={openChangeAnalysis}
          />
          <SubscribeModal open={subscribeOpen} onClose={() => setSubscribeOpen(false)} concept={subscribeConcept} />
          <SaveViewModal open={saveViewOpen} onClose={() => setSaveViewOpen(false)} />
          <ChangeAnalysisModal open={changeAnalysisOpen} onClose={() => setChangeAnalysisOpen(false)} conceptId={changeAnalysisConcept} />

          <TweaksPanel title="Compass · Design tweaks" defaultOpen={false}>
            <TweakSection title="Trust badge prominence" subtitle="PRD §10.4 open question">
              <TweakRadio
                value={tweaks.trustProminence}
                onChange={(v) => setTweak("trustProminence", v)}
                options={[
                  { value: "quiet",  label: "Quiet · icon only" },
                  { value: "medium", label: "Medium · icon + label" },
                  { value: "loud",   label: "Loud · pill" },
                ]}
              />
            </TweakSection>

            <TweakSection title="Verb chip placement" subtitle="PRD §10.5 — ThoughtSpot uses bottom, Tableau uses right rail">
              <TweakRadio
                value={tweaks.chipPlacement}
                onChange={(v) => setTweak("chipPlacement", v)}
                options={[
                  { value: "bottom", label: "Bottom row" },
                  { value: "right",  label: "Right rail" },
                ]}
              />
            </TweakSection>

            <TweakSection title="Metric Detail edit pattern" subtitle="PRD §10.3 — Notion-style vs Linear-style">
              <TweakRadio
                value={tweaks.editStyle}
                onChange={(v) => setTweak("editStyle", v)}
                options={[
                  { value: "inline",   label: "Suggest edit · inline like Notion" },
                  { value: "explicit", label: "Edit mode toggle · Linear-style" },
                ]}
              />
            </TweakSection>

            <TweakSection title="NL search framing" subtitle="PRD §10.1 — manage expectation">
              <TweakRadio
                value={tweaks.searchFraming}
                onChange={(v) => setTweak("searchFraming", v)}
                options={[
                  { value: "smart",  label: "Smart catalog search" },
                  { value: "strict", label: "Strict · autocomplete only" },
                ]}
              />
            </TweakSection>
          </TweaksPanel>
        </GlobalSearchProvider>
      </NavProvider>
    </ToastProvider>
  );
}

function Router({ tweaks, sidebarCollapsed, setSidebarCollapsed, openSubscribe, openSaveView, openChangeAnalysis }) {
  const { route, go } = useNav();

  // Compute breadcrumbs per route
  let breadcrumbs = [];
  let body = null;

  switch (route.name) {
    case "catalog":
      breadcrumbs = [{ label: "Catalog" }];
      body = <CatalogPage tweaks={tweaks} />;
      break;
    case "metric": {
      const c = CONCEPT_BY_ID[route.id];
      breadcrumbs = [
        { label: "Catalog", onClick: () => go({ name: "catalog" }) },
        { label: c?.label || "Metric" },
      ];
      body = <MetricDetailPage
        id={route.id} tweaks={tweaks}
        openSubscribe={() => openSubscribe(c)}
        openSaveView={openSaveView}
        openChangeAnalysis={() => openChangeAnalysis(route.id)}
      />;
      break;
    }
    case "explore":
      breadcrumbs = [{ label: "Explore" }];
      body = <ExplorePage
        initialMeasureId={route.measureId}
        initialDimensionId={route.dimensionId}
        tweaks={tweaks}
        openSaveView={openSaveView}
        openChangeAnalysis={() => openChangeAnalysis(route.measureId || "revenue.total_vnd")}
      />;
      break;
    case "wizard":
      breadcrumbs = [{ label: "Catalog", onClick: () => go({ name: "catalog" }) }, { label: "New concept" }];
      body = <WizardPage />;
      break;
    case "views":
      breadcrumbs = [{ label: "Saved Views" }];
      body = <SavedViewsPage />;
      break;
    case "digest":
      breadcrumbs = [{ label: "Digest" }];
      body = <DigestPage />;
      break;
    case "notifications":
      breadcrumbs = [{ label: "Notifications" }];
      body = <NotificationsPage openChangeAnalysis={(id) => openChangeAnalysis(id)} />;
      break;
    case "workspaces":
      breadcrumbs = [{ label: "Workspaces" }];
      body = <WorkspacesPage />;
      break;
    default:
      body = <div style={{ padding: 40 }}>Unknown route</div>;
  }

  return (
    <AppShell breadcrumbs={breadcrumbs} sidebarCollapsed={sidebarCollapsed} setSidebarCollapsed={setSidebarCollapsed}>
      {body}
    </AppShell>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<CompassApp />);
