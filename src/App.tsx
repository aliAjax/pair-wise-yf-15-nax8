import { useMemo, useState } from "react";
import "./styles.css";
import { STAGES, type Stage } from "./rules";
import { useStore } from "./store";
import {
  BatchPanel,
  CasePanel,
  Header,
  NewSampleForm,
  SampleCard,
  SampleList,
  StageFilter,
} from "./views";

function App() {
  const store = useStore();
  const [stage, setStage] = useState<Stage | "全部">("全部");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { 全部: store.state.samples.length };
    for (const s of STAGES) c[s] = 0;
    for (const s of store.state.samples) c[s.devStage] += 1;
    return c;
  }, [store.state.samples]);

  // 跨标签页同步后，已选样本可能已不存在
  const selected = store.state.samples.find((s) => s.id === selectedId) ?? null;

  return (
    <main className="app">
      <Header store={store} />

      <section className="workspace">
        <StageFilter stage={stage} setStage={setStage} counts={counts} />
        <SampleList
          store={store}
          stage={stage}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </section>

      {selected && (
        <SampleCard
          sample={selected}
          store={store}
          onClose={() => setSelectedId(null)}
        />
      )}

      <BatchPanel store={store} />
      <CasePanel store={store} />
      <NewSampleForm store={store} />
    </main>
  );
}

export default App;
