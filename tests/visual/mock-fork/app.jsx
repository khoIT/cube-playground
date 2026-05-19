// Main app — header + screen router + tweaks panel.

function App() {
  // Tweakable defaults (edit-mode persistable)
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [tab, setTab] = React.useState('playground');     // playground | segments | metrics | catalog
  const [segView, setSegView] = React.useState('library'); // library | detail | editor
  const [segId, setSegId] = React.useState('seg.whales_vn');
  const [pushPattern, setPushPattern] = React.useState('bar'); // bar | sheet | modal

  function gotoSegmentDetail(id) {
    setTab('segments');
    setSegView('detail');
    if (id) setSegId(id);
  }
  function gotoEditor(id) {
    setTab('segments');
    setSegView('editor');
    if (id) setSegId(id);
  }
  function gotoLibrary() {
    setTab('segments');
    setSegView('library');
  }

  return (
    <div className="shell">
      <Header tab={tab} onTab={(t) => {
        setTab(t);
        if (t === 'segments') setSegView('library');
      }}/>

      {tab === 'playground' && (
        <PlaygroundScreen
          goSegment={(id) => gotoSegmentDetail(id)}
          pushPattern={pushPattern}
          setPushPattern={setPushPattern}
        />
      )}

      {tab === 'segments' && segView === 'library' && (
        <LibraryScreen
          goDetail={(id) => gotoSegmentDetail(id)}
          goNew={() => gotoEditor(null)}
        />
      )}

      {tab === 'segments' && segView === 'detail' && (
        <DetailScreen
          segId={segId}
          goLibrary={gotoLibrary}
          goEditor={gotoEditor}
          livePlacement={t.livePlacement}
        />
      )}

      {tab === 'segments' && segView === 'editor' && (
        <EditorScreen
          segId={segId}
          goDetail={gotoSegmentDetail}
          goLibrary={gotoLibrary}
        />
      )}

      {(tab === 'metrics' || tab === 'catalog') && (
        <div className="page">
          <div className="card card-pad">
            <div className="row" style={{ gap: 8 }}>
              <Icon name="sparkles" size={16}/>
              <strong>{tab === 'metrics' ? 'New metric' : 'Catalog'}</strong>
              <span className="muted">— this tab is unchanged by the segment feature. Switch back to Playground or Segments.</span>
            </div>
          </div>
        </div>
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Push-to-segment pattern"/>
        <TweakRadio
          label="Pattern"
          value={t.pushPattern}
          options={['bar', 'sheet', 'modal']}
          onChange={(v) => { setTweak('pushPattern', v); setPushPattern(v); }}
        />

        <TweakSection label="Live-segment status"/>
        <TweakSelect
          label="Placement"
          value={t.livePlacement}
          options={[
            { value: 'header',   label: 'Header pill (default)' },
            { value: 'banner',   label: 'Banner under title' },
            { value: 'floating', label: 'Floating chip · bottom-right' },
            { value: 'all',      label: 'All three (max emphasis)' },
            { value: 'off',      label: 'Off — minimal' },
          ]}
          onChange={(v) => setTweak('livePlacement', v)}
        />

        <TweakSection label="Quick nav"/>
        <TweakButton label="Jump · Results push flow"        onClick={() => { setTab('playground'); }}/>
        <TweakButton label="Jump · Segment library"           onClick={() => { setTab('segments'); setSegView('library'); }}/>
        <TweakButton label="Jump · Whales · VN breakdown"     onClick={() => gotoSegmentDetail('seg.whales_vn')}/>
        <TweakButton label="Jump · Predicate editor"          onClick={() => gotoEditor('seg.whales_vn')}/>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('app')).render(<App/>);
