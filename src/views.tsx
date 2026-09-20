// 法医昆虫学样本保管交接 —— 视图层（列表 / 阶段筛选 / 温度图 / 案件关联 / 交接面板）

import { useMemo, useState } from "react";
import {
  canEdit,
  canReturn,
  isTransferReady,
  nowLocalInput,
  sampleBlockers,
  sortedPoints,
  STATUS_LABEL,
  STAGES,
  PRESERVATIONS,
  EXPOSURE_STAGES,
  type HandoffDraft,
  type Issue,
  type Sample,
  type Stage,
} from "./rules";
import { CASES, USERS, type NewSampleInput, type StoreApi } from "./store";

/* ------------------------------ 通用小部件 ------------------------------ */

function StatusBadge({ sample }: { sample: Sample }) {
  const cls =
    sample.status === "transferred"
      ? "badge badge-transferred"
      : sample.status === "review"
      ? "badge badge-review"
      : "badge badge-held";
  return (
    <span className={cls}>
      {STATUS_LABEL[sample.status]}
      {sample.review ? "·待复核" : ""}
    </span>
  );
}

function IssueTags({ issues }: { issues: Issue[] }) {
  if (issues.length === 0)
    return <span className="ok-text">✔ 满足交接条件</span>;
  return (
    <span className="issues">
      {issues.map((i) => (
        <em key={i.code + i.label}>{i.label}</em>
      ))}
    </span>
  );
}

const fmt = (iso: string) =>
  iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "—";

/* ------------------------------- 指标头部 ------------------------------- */

export function Header({ store }: { store: StoreApi }) {
  const { samples, currentUser } = store.state;
  const held = samples.filter((s) => s.status === "held").length;
  const review = samples.filter((s) => s.status === "review").length;
  const tempsAll = samples.flatMap((s) =>
    s.temps.filter((p) => typeof p.c === "number").map((p) => p.c as number)
  );
  const avg =
    tempsAll.length > 0
      ? (tempsAll.reduce((a, b) => a + b, 0) / tempsAll.length).toFixed(1)
      : "—";
  const pendingId = samples.filter(
    (s) => /复核|待鉴定/.test(s.note) || s.status === "review"
  ).length;

  const metrics = [
    ["样本批次", new Set(samples.map((s) => s.batchNo)).size],
    ["平均温度(℃)", avg],
    ["保管中 / 待复核", `${held} / ${review}`],
    ["待鉴定复核", pendingId],
  ] as const;

  return (
    <header className="hero">
      <p>hxyfront-62003 · 法医昆虫学检材保管链</p>
      <h1>法医昆虫学样本记录与保管交接</h1>
      <span>
        样本保存方式完整、温度曲线无缺档且已关联案件时方可交出；接收人、地点、时间确认后原保管人失去编辑权。
        接收人退回后样本归还原保管人并标记待复核、不得再次转交；同批次任一交接失败则整批保持原状态。
      </span>
      <label className="identity">
        <span>当前身份（用于判断保管权与编辑权）</span>
        <select
          value={currentUser}
          onChange={(e) => store.switchUser(e.target.value)}
        >
          {USERS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <section className="metrics">
        {metrics.map(([name, value]) => (
          <article key={name}>
            <small>{name}</small>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
    </header>
  );
}

/* -------------------------------- 阶段筛选 -------------------------------- */

export function StageFilter({
  stage,
  setStage,
  counts,
}: {
  stage: Stage | "全部";
  setStage: (s: Stage | "全部") => void;
  counts: Record<string, number>;
}) {
  const options: (Stage | "全部")[] = ["全部", ...STAGES];
  return (
    <aside className="panel filter-panel">
      <h2>发育阶段筛选</h2>
      <div className="chips">
        {options.map((s) => (
          <button
            key={s}
            className={stage === s ? "chip active" : "chip"}
            onClick={() => setStage(s)}
          >
            {s}
            <b>{counts[s] ?? 0}</b>
          </button>
        ))}
      </div>
      <p className="hint">
        点击样本列表中的编号可展开详情卡；筛选与当前查看状态均随浏览器存储同步。
      </p>
    </aside>
  );
}

/* -------------------------------- 温度图 -------------------------------- */

export function TemperatureChart({ sample }: { sample: Sample }) {
  const pts = sortedPoints(sample);
  const W = 460;
  const H = 170;
  const PAD = 34;

  if (pts.length === 0) {
    return <div className="chart-empty">暂无温度记录</div>;
  }

  const xs = pts.map((p) => new Date(p.t).getTime());
  const cs = pts.filter((p) => typeof p.c === "number").map((p) => p.c as number);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs, x0 + 1);
  const cMin = cs.length ? Math.floor(Math.min(...cs) - 2) : 0;
  const cMax = cs.length ? Math.ceil(Math.max(...cs) + 2) : 40;

  const x = (t: number) =>
    PAD + ((t - x0) / (x1 - x0 || 1)) * (W - PAD * 2);
  const y = (c: number) =>
    H - PAD - ((c - cMin) / (cMax - cMin || 1)) * (H - PAD * 2);

  // 超过 6.5 小时间隔视为缺档，线段断开
  const segments: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const measured = typeof pts[i].c === "number";
    if (!measured) {
      if (cur.length) segments.push(cur);
      cur = [];
      continue;
    }
    if (i > 0 && xs[i] - xs[i - 1] > 6.5 * 3600_000) {
      if (cur.length) segments.push(cur);
      cur = [];
    }
    cur.push(i);
  }
  if (cur.length) segments.push(cur);

  const gridYs = [cMin, Math.round((cMin + cMax) / 2), cMax];

  return (
    <svg
      className="temp-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${sample.id} 温度曲线`}
    >
      {gridYs.map((g) => (
        <g key={g}>
          <line
            x1={PAD}
            x2={W - PAD}
            y1={y(g)}
            y2={y(g)}
            stroke="#d9e2ef"
            strokeDasharray="4 4"
          />
          <text x={6} y={y(g) + 4} fontSize={10} fill="#64748b">
            {g}℃
          </text>
        </g>
      ))}
      {segments.map((seg, si) => (
        <polyline
          key={si}
          fill="none"
          stroke="#365314"
          strokeWidth={2}
          points={seg
            .map((i) => `${x(xs[i])},${y(pts[i].c as number)}`)
            .join(" ")}
        />
      ))}
      {pts.map((p, i) =>
        typeof p.c === "number" ? (
          <circle
            key={p.t}
            cx={x(xs[i])}
            cy={y(p.c)}
            r={3.2}
            fill="#a16207"
          >
            <title>{`${fmt(p.t)}：${p.c}℃`}</title>
          </circle>
        ) : (
          <text key={p.t} x={x(xs[i])} y={H - 10} fontSize={9} fill="#dc2626">
            缺测
          </text>
        )
      )}
      {pts.slice(1).map((p, i) =>
        xs[i + 1] - xs[i] > 6.5 * 3600_000 ? (
          <text
            key={"gap" + p.t}
            x={(x(xs[i]) + x(xs[i + 1])) / 2 - 14}
            y={16}
            fontSize={10}
            fill="#dc2626"
          >
            缺档
          </text>
        ) : null
      )}
      <text x={PAD} y={H - 8} fontSize={10} fill="#64748b">
        {fmt(pts[0].t)}
      </text>
      <text x={W - PAD - 90} y={H - 8} fontSize={10} fill="#64748b">
        {fmt(pts[pts.length - 1].t)}
      </text>
    </svg>
  );
}

/* ------------------------------ 样本详情卡 ------------------------------ */

export function SampleCard({
  sample,
  store,
  onClose,
}: {
  sample: Sample;
  store: StoreApi;
  onClose: () => void;
}) {
  const currentUser = store.state.currentUser;
  const editable = canEdit(sample, currentUser);
  const issues = sampleBlockers(sample, currentUser);
  const [returning, setReturning] = useState(false);
  const [returnPlace, setReturnPlace] = useState("");
  const [returnTime, setReturnTime] = useState(nowLocalInput());
  const [returnError, setReturnError] = useState<string | null>(null);

  const caseName =
    CASES.find((c) => c.id === sample.caseId)?.name ?? "未关联案件";

  const submitReturn = () => {
    const err = store.returnSample(sample.id, returnPlace, returnTime);
    if (err) setReturnError(err);
    else setReturning(false);
  };

  return (
    <article className="panel detail-card">
      <div className="heading">
        <div>
          <p>{sample.batchNo}</p>
          <h2>
            {sample.id} · {sample.species}
          </h2>
        </div>
        <button onClick={onClose}>收起详情</button>
      </div>

      <div className="detail-top">
        <StatusBadge sample={sample} />
        <span>
          当前保管人：<b>{sample.owner}</b>
          {sample.handoff && (
            <small>
              {" "}
              （{sample.handoff.receiver} 于 {fmt(sample.handoff.time)} 在
              {sample.handoff.place} 接收）
            </small>
          )}
        </span>
        <span className={editable ? "ok-text" : "lock-text"}>
          {editable ? "✔ 你持有编辑权" : "🔒 你无编辑权（非当前保管人）"}
        </span>
      </div>

      <dl className="detail-grid">
        <div>
          <dt>采样地点</dt>
          <dd>
            {editable ? (
              <input
                value={sample.location}
                onChange={(e) =>
                  store.updateSample(sample.id, { location: e.target.value })
                }
              />
            ) : (
              sample.location
            )}
          </dd>
        </div>
        <div>
          <dt>采样时间</dt>
          <dd>{fmt(sample.sampledAt)}</dd>
        </div>
        <div>
          <dt>尸体暴露阶段</dt>
          <dd>{sample.exposureStage}</dd>
        </div>
        <div>
          <dt>发育阶段</dt>
          <dd>{sample.devStage}</dd>
        </div>
        <div>
          <dt>保存方式</dt>
          <dd>
            {editable ? (
              <select
                value={sample.preservation}
                onChange={(e) =>
                  store.updateSample(sample.id, { preservation: e.target.value })
                }
              >
                <option value="">（未填写 —— 保存方式不完整）</option>
                {PRESERVATIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            ) : (
              sample.preservation || "未填写"
            )}
          </dd>
        </div>
        <div>
          <dt>关联案件</dt>
          <dd>
            {sample.caseId
              ? `${sample.caseId} · ${caseName}`
              : "未关联案件（不可交接）"}
          </dd>
        </div>
      </dl>

      <label className="note-edit">
        <span>鉴定备注</span>
        {editable ? (
          <textarea
            rows={2}
            value={sample.note}
            onChange={(e) =>
              store.updateSample(sample.id, { note: e.target.value })
            }
          />
        ) : (
          <p>{sample.note || "—"}</p>
        )}
      </label>

      <div className="chart-wrap">
        <div className="chart-head">
          <h3>环境温度曲线（6h 间隔）</h3>
          <IssueTags issues={issues} />
        </div>
        <TemperatureChart sample={sample} />
        {editable && <TempEditor sample={sample} store={store} />}
      </div>

      {sample.events.length > 0 && (
        <div className="custody-log">
          <h3>保管交接记录</h3>
          <ol>
            {sample.events.map((e, i) => (
              <li key={i}>
                <b>{e.kind === "transfer" ? "交出" : "退回"}</b>
                {e.from} → {e.to}｜{e.place}｜{fmt(e.time)}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="detail-actions">
        {canReturn(sample, currentUser) && !returning && (
          <button className="danger" onClick={() => setReturning(true)}>
            退回原保管人（{sample.originalOwner}）
          </button>
        )}
        {returning && (
          <div className="return-box">
            <label>
              <span>退回地点</span>
              <input
                value={returnPlace}
                placeholder="确认退回交接地点"
                onChange={(e) => setReturnPlace(e.target.value)}
              />
            </label>
            <label>
              <span>退回时间</span>
              <input
                type="datetime-local"
                value={returnTime}
                onChange={(e) => setReturnTime(e.target.value)}
              />
            </label>
            <button className="danger" onClick={submitReturn}>
              确认退回
            </button>
            <button
              onClick={() => {
                setReturning(false);
                setReturnError(null);
              }}
            >
              取消
            </button>
            {returnError && <em className="error-text">{returnError}</em>}
          </div>
        )}
        {sample.status === "review" && (
          <em className="warn-text">
            该样本为接收人退回件，已归还原保管人并标记待复核，不能再次转交。
          </em>
        )}
      </div>
    </article>
  );
}

/** 当前保管人可补录 / 修改温度点（自动按时刻排序，删除点会造成缺档） */
function TempEditor({ sample, store }: { sample: Sample; store: StoreApi }) {
  const [t, setT] = useState("");
  const [c, setC] = useState("");

  const upsert = () => {
    if (!t || c === "") return;
    const iso = new Date(t).toISOString();
    const rest = sample.temps.filter((p) => p.t !== iso);
    const next = [...rest, { t: iso, c: Number(c) }].sort(
      (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime()
    );
    store.updateSample(sample.id, { temps: next });
    setT("");
    setC("");
  };
  const remove = (iso: string) =>
    store.updateSample(sample.id, {
      temps: sample.temps.filter((p) => p.t !== iso),
    });

  return (
    <div className="temp-editor">
      <div className="temp-add">
        <input type="datetime-local" value={t} onChange={(e) => setT(e.target.value)} />
        <input
          type="number"
          step="0.1"
          placeholder="温度 ℃"
          value={c}
          onChange={(e) => setC(e.target.value)}
        />
        <button onClick={upsert}>补录温度点</button>
      </div>
      <ul className="temp-list">
        {sortedPoints(sample).map((p) => (
          <li key={p.t}>
            {fmt(p.t)} · {p.c === null ? "缺测" : `${p.c}℃`}
            <button onClick={() => remove(p.t)}>删除</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------ 批量交接面板 ------------------------------ */

export function BatchPanel({ store }: { store: StoreApi }) {
  const { samples, currentUser } = store.state;
  const batches = useMemo(() => {
    const map = new Map<string, Sample[]>();
    for (const s of samples) {
      map.set(s.batchNo, [...(map.get(s.batchNo) ?? []), s]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [samples]);

  const [batchNo, setBatchNo] = useState<string>(batches[0]?.[0] ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<HandoffDraft>({
    receiver: USERS.find((u) => u !== currentUser) ?? "",
    place: "",
    time: nowLocalInput(),
  });
  const [failures, setFailures] = useState<
    { id: string; reasons: string[] }[]
  >([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const activeBatch = batches.find(([no]) => no === batchNo)?.[1] ?? [];
  const ids = [...picked].filter((id) =>
    activeBatch.some((s) => s.id === id)
  );

  const toggle = (id: string) => {
    setFailures([]);
    setGlobalError(null);
    setSuccessMsg(null);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllMine = () => {
    const allReady = activeBatch.every((s) =>
      picked.has(s.id)
    );
    setPicked(
      allReady
        ? new Set()
        : new Set(activeBatch.map((s) => s.id))
    );
  };

  const submit = () => {
    const res = store.transferBatch(ids, draft);
    if (res.ok) {
      setFailures([]);
      setGlobalError(null);
      setPicked(new Set());
      setSuccessMsg(
        `批次 ${batchNo} 的 ${ids.length} 个样本已完成交接，原保管人编辑权已移交 ${draft.receiver}`
      );
    } else {
      // 任一交接失败 → 整批保持原状态
      setSuccessMsg(null);
      setGlobalError(
        res.globalError ??
          `批次 ${batchNo} 交接失败：存在不合格样本，整批保持原状态，未发生任何移交。`
      );
      setFailures(res.failures.map((f) => ({ id: f.id, reasons: f.reasons })));
    }
  };

  if (batches.length === 0) return null;

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>保管链交接</p>
          <h2>同批次样本交接</h2>
        </div>
        <label className="batch-select">
          <span>选择批次</span>
          <select
            value={batchNo}
            onChange={(e) => {
              setBatchNo(e.target.value);
              setPicked(new Set());
              setFailures([]);
              setGlobalError(null);
              setSuccessMsg(null);
            }}
          >
            {batches.map(([no, list]) => (
              <option key={no} value={no}>
                {no}（{list.length} 个样本）
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="batch-table">
        <div className="batch-row batch-head-row">
          <button onClick={selectAllMine}>全选/清空</button>
          <span>样本</span>
          <span>保管人 / 状态</span>
          <span>交接前检查</span>
        </div>
        {activeBatch.map((s) => {
          const issues = sampleBlockers(s, currentUser);
          const failedHere = failures.find((f) => f.id === s.id);
          return (
            <div
              key={s.id}
              className={
                "batch-row" +
                (failedHere ? " row-failed" : "") +
                (isTransferReady(s, currentUser) ? " row-ready" : "")
              }
            >
              <input
                type="checkbox"
                checked={picked.has(s.id)}
                onChange={() => toggle(s.id)}
              />
              <span>
                <b>{s.id}</b>
                <small>
                  {s.devStage} · {s.species} · {s.location}
                </small>
              </span>
              <span>
                {s.owner}
                <StatusBadge sample={s} />
              </span>
              <span className="cell-issues">
                <IssueTags issues={issues} />
                {failedHere && (
                  <ul className="fail-list">
                    {failedHere.reasons.map((r) => (
                      <li key={r}>✗ {r}</li>
                    ))}
                  </ul>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="handoff-form">
        <label>
          <span>接收人</span>
          <select
            value={draft.receiver}
            onChange={(e) => setDraft({ ...draft, receiver: e.target.value })}
          >
            {USERS.map((u) => (
              <option key={u} value={u} disabled={u === currentUser}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>交接地点</span>
          <input
            value={draft.place}
            placeholder="如：市局物证中心 3 号交接台"
            onChange={(e) => setDraft({ ...draft, place: e.target.value })}
          />
        </label>
        <label>
          <span>交接时间</span>
          <input
            type="datetime-local"
            value={draft.time}
            onChange={(e) => setDraft({ ...draft, time: e.target.value })}
          />
        </label>
        <button
          className="primary"
          disabled={ids.length === 0}
          onClick={submit}
        >
          确认交出选中样本（{ids.length}）
        </button>
      </div>

      {globalError && <p className="error-text">⚠ {globalError}</p>}
      {successMsg && <p className="ok-text">{successMsg}</p>}
      <p className="hint">
        交接规则：接收人、地点与时间全部确认后方可提交；同批次任一样本检查不通过，整批保持原状态。
      </p>
    </section>
  );
}

/* ------------------------------ 案件关联面板 ------------------------------ */

export function CasePanel({ store }: { store: StoreApi }) {
  const { samples } = store.state;
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>案件样本关联</p>
          <h2>样本与案件绑定</h2>
        </div>
      </div>
      <div className="case-grid">
        {CASES.map((c) => {
          const list = samples.filter((s) => s.caseId === c.id);
          return (
            <article key={c.id} className="case-card">
              <h3>
                {c.id} · {c.name}
              </h3>
              <p>{list.length} 个关联样本</p>
              <ul>
                {list.map((s) => (
                  <li key={s.id}>
                    {s.id}（{s.batchNo}）
                    <button
                      className="link-btn"
                      onClick={() =>
                        store.updateSample(s.id, { caseId: null })
                      }
                    >
                      解除关联
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
        <article className="case-card case-unlinked">
          <h3>未关联案件</h3>
          <p>此类样本不允许交接</p>
          <ul>
            {samples
              .filter((s) => !s.caseId)
              .map((s) => (
                <li key={s.id}>
                  {s.id}（{s.batchNo}）
                  <select
                    value=""
                    onChange={(e) =>
                      store.updateSample(s.id, { caseId: e.target.value })
                    }
                  >
                    <option value="">关联到案件…</option>
                    {CASES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id} · {c.name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

/* ------------------------------- 新增样本 ------------------------------- */

export function NewSampleForm({ store }: { store: StoreApi }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<NewSampleInput>({
    batchNo: "",
    caseId: "",
    location: "",
    exposureStage: EXPOSURE_STAGES[0],
    species: "",
    devStage: "幼虫",
    sampledAt: nowLocalInput(),
    preservation: "",
    note: "",
    temps: [{ t: nowLocalInput(), c: 25 }],
  });

  const set = <K extends keyof NewSampleInput>(
    key: K,
    value: NewSampleInput[K]
  ) => setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    const input: NewSampleInput = {
      ...form,
      temps: form.temps
        .filter((p) => p.t)
        .map((p) => ({
          t: p.t ? new Date(p.t).toISOString() : "",
          c: p.c === null || (p.c as unknown) === "" ? null : Number(p.c),
        })),
    };
    store.addSample(input);
    setOpen(false);
    setForm({
      batchNo: "",
      caseId: "",
      location: "",
      exposureStage: EXPOSURE_STAGES[0],
      species: "",
      devStage: "幼虫",
      sampledAt: nowLocalInput(),
      preservation: "",
      note: "",
      temps: [{ t: nowLocalInput(), c: 25 }],
    });
  };

  if (!open)
    return (
      <section className="panel">
        <div className="heading">
          <div>
            <p>采样登记</p>
            <h2>新增样本记录</h2>
          </div>
          <button className="primary" onClick={() => setOpen(true)}>
            登记新样本
          </button>
        </div>
      </section>
    );

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>采样登记</p>
          <h2>新增样本记录</h2>
        </div>
        <button onClick={() => setOpen(false)}>收起</button>
      </div>
      <div className="field-grid">
        <label>
          <span>批次编号</span>
          <input
            value={form.batchNo}
            placeholder="如 B-2026-051-3（同批次才能整批交接）"
            onChange={(e) => set("batchNo", e.target.value)}
          />
        </label>
        <label>
          <span>关联案件</span>
          <select
            value={form.caseId}
            onChange={(e) => set("caseId", e.target.value)}
          >
            <option value="">（未关联 —— 交接将被阻止）</option>
            {CASES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>采样地点</span>
          <input
            value={form.location}
            onChange={(e) => set("location", e.target.value)}
          />
        </label>
        <label>
          <span>采样时间</span>
          <input
            type="datetime-local"
            value={form.sampledAt}
            onChange={(e) => set("sampledAt", e.target.value)}
          />
        </label>
        <label>
          <span>尸体暴露阶段</span>
          <select
            value={form.exposureStage}
            onChange={(e) => set("exposureStage", e.target.value)}
          >
            {EXPOSURE_STAGES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          <span>发育阶段</span>
          <select
            value={form.devStage}
            onChange={(e) => set("devStage", e.target.value as Stage)}
          >
            {STAGES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          <span>昆虫种类</span>
          <input
            value={form.species}
            placeholder="如 丝光绿蝇 Lucilia sericata"
            onChange={(e) => set("species", e.target.value)}
          />
        </label>
        <label>
          <span>保存方式</span>
          <select
            value={form.preservation}
            onChange={(e) => set("preservation", e.target.value)}
          >
            <option value="">（未填写 —— 不可交接）</option>
            {PRESERVATIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="note-edit">
        <span>鉴定备注</span>
        <textarea
          rows={2}
          value={form.note}
          onChange={(e) => set("note", e.target.value)}
        />
      </label>

      <div className="new-temps">
        <span>温度曲线首点（采样时刻，建议按 6 小时间隔补录）</span>
        <div className="temp-add">
          <input
            type="datetime-local"
            value={form.temps[0]?.t ?? ""}
            onChange={(e) =>
              set("temps", [{ ...form.temps[0], t: e.target.value }])
            }
          />
          <input
            type="number"
            step="0.1"
            value={form.temps[0]?.c ?? ""}
            onChange={(e) =>
              set("temps", [
                {
                  ...form.temps[0],
                  c: e.target.value === "" ? null : Number(e.target.value),
                },
              ])
            }
          />
        </div>
      </div>

      <div className="form-actions">
        <button
          className="primary"
          disabled={!form.location || !form.species || !form.sampledAt}
          onClick={submit}
        >
          保存样本
        </button>
      </div>
    </section>
  );
}

/* -------------------------------- 样本列表 -------------------------------- */

export function SampleList({
  store,
  stage,
  selectedId,
  onSelect,
}: {
  store: StoreApi;
  stage: Stage | "全部";
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { samples, currentUser } = store.state;
  const list = samples.filter((s) => stage === "全部" || s.devStage === stage);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>样本批次列表</p>
          <h2>
            记录工作台（{list.length}/{samples.length}）
          </h2>
        </div>
        <button onClick={store.resetDemo}>恢复演示数据</button>
      </div>
      <div className="records">
        {list.map((s, index) => {
          const caseLabel = s.caseId ?? "未关联案件";
          return (
            <article
              key={s.id}
              className={
                "record-row" + (selectedId === s.id ? " selected" : "")
              }
            >
              <b>{String(index + 1).padStart(2, "0")}</b>
              <div className="record-main" onClick={() => onSelect(s.id)}>
                <h3>
                  {s.id} <small>{s.batchNo}</small>
                </h3>
                <p>
                  {caseLabel} · {s.location} · {s.devStage} · {s.species} ·{" "}
                  {s.preservation || "保存方式缺失"} · {s.temps.length} 个温度点
                </p>
                <div className="record-meta">
                  <StatusBadge sample={s} />
                  <small>
                    保管人：{s.owner}
                    {s.owner !== currentUser && "（你无编辑权）"}
                  </small>
                </div>
              </div>
              <button className="detail-btn" onClick={() => onSelect(s.id)}>
                详情
              </button>
            </article>
          );
        })}
        {list.length === 0 && <p className="hint">当前筛选下没有样本。</p>}
      </div>
    </section>
  );
}
