import { useMemo, useState } from "react";
import "./styles.css";
import { CustodyBoard, Messages } from "./custody/CustodyBoard";
import { sortedLog, STAGES, CUSTODY_STATUSES, type Stage } from "./custody/rules";
import { useCustodyStore, type ActionResult, type NewSampleDraft } from "./custody/store";

const project = {
  "sourceNo": 5,
  "id": "hxyfront-62003",
  "port": 62003,
  "title": "法医昆虫学样本记录",
  "domain": "法医昆虫学",
  "prompt": "做一个法医昆虫学样本记录前端工具，用来记录采样地点、环境温度、尸体暴露阶段、昆虫种类、发育阶段、采样时间、保存方式和鉴定备注。页面需要有样本批次列表、发育阶段筛选、温度记录图、案件样本关联页和单个样本详情卡片。",
  "metrics": [
    "样本批次",
    "平均温度",
    "发育阶段",
    "待鉴定"
  ]
};

const emptyDraft: NewSampleDraft = {
  location: "",
  species: "",
  stage: "幼虫",
  exposureStage: "",
  sampledAt: "",
  preservation: "",
  notes: "",
  temperature: "",
};

function App() {
  const store = useCustodyStore();
  const [stageFilter, setStageFilter] = useState<Stage | "全部">("全部");
  const [draft, setDraft] = useState<NewSampleDraft>(emptyDraft);
  const [formResult, setFormResult] = useState<ActionResult | null>(null);

  const metrics = useMemo(() => {
    const latestTemps = store.samples
      .map((s) => {
        const log = sortedLog(s);
        return log.length > 0 ? log[log.length - 1].celsius : undefined;
      })
      .filter((t): t is number => typeof t === "number");
    const avgTemp = latestTemps.length
      ? `${(latestTemps.reduce((a, b) => a + b, 0) / latestTemps.length).toFixed(1)}℃`
      : "—";
    const stageCount = new Set(store.samples.map((s) => s.stage)).size;
    const pendingId = store.samples.filter((s) => !s.notes.trim()).length;
    return [String(store.samples.length), avgTemp, `${stageCount} 类`, String(pendingId)];
  }, [store.samples]);

  const statusSummary = useMemo(() => {
    const counts = new Map<string, number>();
    store.samples.forEach((s) => counts.set(s.status, (counts.get(s.status) ?? 0) + 1));
    return counts;
  }, [store.samples]);

  const submitDraft = () => {
    const result = store.addSample(draft);
    setFormResult(result);
    if (result.ok) setDraft(emptyDraft);
  };

  return (
    <main className="app">
      <section className="hero">
        <p>{project.id} · 源提示词{project.sourceNo} · Port {project.port}</p>
        <h1>{project.title}</h1>
        <span>{project.prompt}</span>
      </section>

      <section className="metrics">
        {project.metrics.map((metric: string, index: number) => (
          <article key={metric}>
            <small>{metric}</small>
            <strong>{metrics[index] ?? "—"}</strong>
          </article>
        ))}
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>{project.domain}筛选</h2>
          <div className="chips">
            {(["全部", ...STAGES] as const).map((item) => (
              <button
                key={item}
                className={stageFilter === item ? "chip-active" : ""}
                onClick={() => setStageFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="status-summary">
            {CUSTODY_STATUSES.map((st) => (
              <p key={st}>
                <span>{st}</span>
                <b>{statusSummary.get(st) ?? 0}</b>
              </p>
            ))}
          </div>
          <p className="hint">
            交出条件：保存方式完整、温度曲线无缺档、已关联案件；退回样本不得再次转交。
          </p>
        </aside>

        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>专业字段</p>
              <h2>新增记录</h2>
            </div>
            <button className="primary" onClick={submitDraft}>保存样本</button>
          </div>
          <Messages result={formResult} />
          <div className="field-grid">
            <label>
              <span>采样地点</span>
              <input
                placeholder="填写采样地点"
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              />
            </label>
            <label>
              <span>环境温度（℃）</span>
              <input
                type="number"
                step="0.1"
                placeholder="填写环境温度"
                value={draft.temperature}
                onChange={(e) => setDraft({ ...draft, temperature: e.target.value })}
              />
            </label>
            <label>
              <span>暴露阶段</span>
              <input
                placeholder="如：肿胀期 / 腐烂期"
                value={draft.exposureStage}
                onChange={(e) => setDraft({ ...draft, exposureStage: e.target.value })}
              />
            </label>
            <label>
              <span>昆虫种类</span>
              <input
                placeholder="填写昆虫种类"
                value={draft.species}
                onChange={(e) => setDraft({ ...draft, species: e.target.value })}
              />
            </label>
            <label>
              <span>发育阶段</span>
              <select
                value={draft.stage}
                onChange={(e) => setDraft({ ...draft, stage: e.target.value as Stage })}
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>保存方式</span>
              <input
                placeholder="如：75%乙醇保存"
                value={draft.preservation}
                onChange={(e) => setDraft({ ...draft, preservation: e.target.value })}
              />
            </label>
            <label>
              <span>采样时间</span>
              <input
                type="datetime-local"
                value={draft.sampledAt}
                onChange={(e) => setDraft({ ...draft, sampledAt: e.target.value })}
              />
            </label>
            <label>
              <span>鉴定备注</span>
              <input
                placeholder="填写鉴定备注"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </label>
          </div>
        </section>
      </section>

      <CustodyBoard store={store} stageFilter={stageFilter} />

      <footer className="footer">
        <span>数据保存在浏览器 localStorage，刷新不丢失。</span>
        <button onClick={store.resetAll}>重置演示数据</button>
      </footer>
    </main>
  );
}

export default App;
