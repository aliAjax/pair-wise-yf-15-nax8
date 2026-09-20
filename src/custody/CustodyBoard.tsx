// 保管交接视图：批次列表 + 交接操作栏 + 样本详情卡（温度图/案件关联/交接时间线）+ 案件面板。
// 所有业务判断委托 rules.ts，数据变更委托 store.ts。

import { useEffect, useMemo, useState } from "react";
import {
  canEdit,
  checkHandoverEligibility,
  findTemperatureGaps,
  sortedLog,
  MAX_GAP_MS,
  STAGES,
  type CustodyStatus,
  type Sample,
  type Stage,
} from "./rules";
import type { ActionResult, CustodyStore } from "./store";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nowLocalInput(): string {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

const STATUS_CLASS: Record<CustodyStatus, string> = {
  在库: "st-storage",
  交接中: "st-transit",
  已交接: "st-done",
  待复核: "st-review",
};

function StatusBadge({ status }: { status: CustodyStatus }) {
  return <span className={`badge ${STATUS_CLASS[status]}`}>{status}</span>;
}

export function Messages({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <div className={`messages ${result.ok ? "ok" : "err"}`}>
      {result.messages.map((m) => (
        <p key={m}>{m}</p>
      ))}
    </div>
  );
}

function EligibilityItems({ sample }: { sample: Sample }) {
  const gaps = findTemperatureGaps(sample);
  const items = [
    { ok: sample.preservation.trim() !== "", label: "保存方式完整" },
    { ok: gaps.length === 0, label: gaps.length === 0 ? "温度曲线无缺档" : `温度缺档 ${gaps.length} 处` },
    { ok: sample.caseId !== null, label: sample.caseId ? `已关联 ${sample.caseId}` : "未关联案件" },
    { ok: !sample.returned, label: sample.returned ? "已退回锁定，不得转交" : "未被退回锁定" },
  ];
  return (
    <ul className="eligibility">
      {items.map((it) => (
        <li key={it.label} className={it.ok ? "pass" : "fail"}>
          {it.ok ? "✓" : "✗"} {it.label}
        </li>
      ))}
    </ul>
  );
}

function TemperatureChart({ sample }: { sample: Sample }) {
  const W = 640;
  const H = 220;
  const PAD = { l: 46, r: 14, t: 16, b: 32 };
  const log = sortedLog(sample);
  const gaps = findTemperatureGaps(sample);
  if (log.length === 0) return <p className="empty">暂无温度记录，请补录。</p>;

  const now = Date.now();
  const times = log.map((p) => +new Date(p.at));
  const temps = log.map((p) => p.celsius);
  const minX = Math.min(...times, +new Date(sample.sampledAt));
  const maxX = Math.max(...times, now);
  const minT = Math.floor(Math.min(...temps) - 1);
  const maxT = Math.ceil(Math.max(...temps) + 1);
  const x = (t: number) => PAD.l + ((t - minX) / Math.max(1, maxX - minX)) * (W - PAD.l - PAD.r);
  const y = (c: number) => PAD.t + (1 - (c - minT) / Math.max(1, maxT - minT)) * (H - PAD.t - PAD.b);

  // 相邻记录间隔超过阈值则断开折线，断点处即缺档
  const segments: string[] = [];
  let current: string[] = [];
  log.forEach((p, i) => {
    const point = `${x(+new Date(p.at)).toFixed(1)},${y(p.celsius).toFixed(1)}`;
    if (i > 0 && +new Date(p.at) - +new Date(log[i - 1].at) > MAX_GAP_MS) {
      segments.push(current.join(" "));
      current = [];
    }
    current.push(point);
  });
  if (current.length > 0) segments.push(current.join(" "));

  const gridTemps = [minT, Math.round((minT + maxT) / 2), maxT];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="temp-chart" role="img" aria-label="温度记录曲线">
        {gridTemps.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.l - 6} y={y(t) + 4} className="axis-label" textAnchor="end">
              {t}℃
            </text>
          </g>
        ))}
        {gaps.map((g) => (
          <rect
            key={g.from}
            x={x(+new Date(g.from))}
            y={PAD.t}
            width={Math.max(2, x(+new Date(g.to)) - x(+new Date(g.from)))}
            height={H - PAD.t - PAD.b}
            className="gap-band"
          />
        ))}
        {segments.map((seg) => (
          <polyline key={seg} points={seg} className="temp-line" />
        ))}
        {log.map((p) => (
          <circle key={p.at} cx={x(+new Date(p.at))} cy={y(p.celsius)} r={3} className="temp-dot">
            <title>{`${fmtTime(p.at)} · ${p.celsius}℃`}</title>
          </circle>
        ))}
        <text x={PAD.l} y={H - 8} className="axis-label">
          {fmtTime(new Date(minX).toISOString())}
        </text>
        <text x={W - PAD.r} y={H - 8} className="axis-label" textAnchor="end">
          {fmtTime(new Date(maxX).toISOString())}
        </text>
      </svg>
      {gaps.length > 0 && (
        <ul className="gap-list">
          {gaps.map((g, i) => (
            <li key={g.from}>
              缺档{i + 1}：{fmtTime(g.from)} ~ {fmtTime(g.to)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Timeline({ sample }: { sample: Sample }) {
  return (
    <ol className="timeline">
      {sample.history.map((e, i) => (
        <li key={`${e.at}-${i}`}>
          <span className="t-time">{fmtTime(e.at)}</span>
          <span className="t-type">{e.type}</span>
          <span className="t-detail">
            {e.actor} · {e.detail}
          </span>
        </li>
      ))}
    </ol>
  );
}

function DetailCard({ store, sample }: { store: CustodyStore; sample: Sample }) {
  const editable = canEdit(sample, store.currentUser);
  const [draft, setDraft] = useState({
    location: sample.location,
    species: sample.species,
    exposureStage: sample.exposureStage,
    stage: sample.stage,
    preservation: sample.preservation,
    notes: sample.notes,
  });
  const [tempInput, setTempInput] = useState("");
  const [returnNote, setReturnNote] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);

  useEffect(() => {
    setDraft({
      location: sample.location,
      species: sample.species,
      exposureStage: sample.exposureStage,
      stage: sample.stage,
      preservation: sample.preservation,
      notes: sample.notes,
    });
    setTempInput("");
    setReturnNote("");
    setResult(null);
  }, [sample.id, sample.history.length, sample.status]);

  const eligibility = checkHandoverEligibility(sample);
  const pending = sample.pendingHandover;

  const field = (key: keyof typeof draft, label: string) => (
    <label>
      <span>{label}</span>
      {key === "stage" ? (
        <select
          value={draft.stage}
          disabled={!editable}
          onChange={(e) => setDraft({ ...draft, stage: e.target.value as Stage })}
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={draft[key]}
          disabled={!editable}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        />
      )}
    </label>
  );

  return (
    <section className="panel detail-card">
      <div className="heading">
        <div>
          <p>样本详情卡片</p>
          <h2>
            {sample.id} <StatusBadge status={sample.status} />
          </h2>
        </div>
        <div className="custodian-tag">
          当前保管人：<b>{sample.custodian}</b>
          {editable ? "（你持有编辑权）" : `（编辑权归 ${sample.custodian}）`}
        </div>
      </div>

      <Messages result={result} />

      <div className="detail-grid">
        <div>
          <h3>基础信息</h3>
          <div className="field-grid">
            {field("location", "采样地点")}
            {field("species", "昆虫种类")}
            {field("exposureStage", "暴露阶段")}
            {field("stage", "发育阶段")}
            {field("preservation", "保存方式")}
            <label>
              <span>采样时间</span>
              <input value={fmtTime(sample.sampledAt)} disabled />
            </label>
          </div>
          <label className="notes-field">
            <span>鉴定备注</span>
            <input
              value={draft.notes}
              disabled={!editable}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </label>
          <label className="notes-field">
            <span>案件关联</span>
            <select
              value={sample.caseId ?? ""}
              disabled={!editable}
              onChange={(e) => setResult(store.linkCase(sample.id, e.target.value || null))}
            >
              <option value="">未关联</option>
              {store.cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {c.title}
                </option>
              ))}
            </select>
          </label>
          {editable && (
            <div className="row-actions">
              <button
                className="primary"
                onClick={() =>
                  setResult(
                    store.updateSample(sample.id, {
                      location: draft.location,
                      species: draft.species,
                      exposureStage: draft.exposureStage,
                      stage: draft.stage,
                      preservation: draft.preservation,
                      notes: draft.notes,
                    })
                  )
                }
              >
                保存修改
              </button>
            </div>
          )}
          <EligibilityItems sample={sample} />
          {!eligibility.ok && <p className="hint">满足全部条件后方可交出。</p>}
        </div>

        <div>
          <h3>温度记录曲线</h3>
          <TemperatureChart sample={sample} />
          {editable && (
            <div className="row-actions">
              <input
                className="temp-input"
                type="number"
                step="0.1"
                placeholder="补录温度 ℃"
                value={tempInput}
                onChange={(e) => setTempInput(e.target.value)}
              />
              <button
                onClick={() => {
                  const r = store.addTemperature(sample.id, Number(tempInput));
                  setResult(r);
                  if (r.ok) setTempInput("");
                }}
              >
                补录当前温度
              </button>
            </div>
          )}

          <h3>交接状态</h3>
          {sample.status === "交接中" && pending && (
            <div className="handover-box">
              <p>
                等待 <b>{pending.to}</b> 于 <b>{pending.location}</b> 在 {fmtTime(pending.at)} 确认接收；
                确认后 {pending.by} 失去编辑权，{pending.to} 取得。
              </p>
              {store.currentUser === pending.to ? (
                <button className="primary" onClick={() => setResult(store.confirm(sample.id))}>
                  确认接收
                </button>
              ) : (
                <p className="hint">请以接收人 {pending.to} 身份确认。</p>
              )}
            </div>
          )}
          {sample.status === "已交接" && (
            <div className="handover-box">
              <p>
                已由 {sample.custodian} 接收{sample.lastHandoverFrom ? `（原保管人 ${sample.lastHandoverFrom}）` : ""}。
              </p>
              {store.currentUser === sample.custodian ? (
                <div className="row-actions">
                  <input
                    placeholder="退回原因（可选）"
                    value={returnNote}
                    onChange={(e) => setReturnNote(e.target.value)}
                  />
                  <button className="danger" onClick={() => setResult(store.returnBack(sample.id, returnNote))}>
                    退回原保管人
                  </button>
                </div>
              ) : (
                <p className="hint">仅当前保管人 {sample.custodian} 可执行退回。</p>
              )}
            </div>
          )}
          {sample.status === "待复核" && (
            <div className="handover-box review">
              <p>样本已退回原保管人 {sample.custodian}，标记待复核，不得再次转交。</p>
            </div>
          )}
          {sample.status === "在库" && (
            <p className="hint">样本在库，可在上方列表勾选后发起批次交接。</p>
          )}

          <h3>保管时间线</h3>
          <Timeline sample={sample} />
        </div>
      </div>
    </section>
  );
}

export function CustodyBoard({
  store,
  stageFilter,
}: {
  store: CustodyStore;
  stageFilter: Stage | "全部";
}) {
  const filtered = useMemo(
    () => store.samples.filter((s) => stageFilter === "全部" || s.stage === stageFilter),
    [store.samples, stageFilter]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [receiver, setReceiver] = useState("");
  const [location, setLocation] = useState("");
  const [handoverAt, setHandoverAt] = useState(nowLocalInput());
  const [batchResult, setBatchResult] = useState<ActionResult | null>(null);

  useEffect(() => {
    if (!store.samples.some((s) => s.id === selectedId)) {
      setSelectedId(store.samples[0]?.id ?? null);
    }
  }, [store.samples, selectedId]);

  const selected = store.samples.find((s) => s.id === selectedId) ?? null;
  const effectiveReceiver = receiver || store.custodians.find((c) => c !== store.currentUser) || "";

  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };

  const submitBatch = () => {
    const result = store.initiateBatch([...checked], {
      to: effectiveReceiver,
      location,
      at: handoverAt ? new Date(handoverAt).toISOString() : "",
    });
    setBatchResult(result);
    if (result.ok) setChecked(new Set());
  };

  return (
    <>
      <section className="panel">
        <div className="heading">
          <div>
            <p>保管交接</p>
            <h2>样本批次列表</h2>
          </div>
          <div className="user-switch">
            <span>当前操作人</span>
            <select value={store.currentUser} onChange={(e) => store.setCurrentUser(e.target.value)}>
              {store.custodians.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="batch-bar">
          <label>
            <span>接收人</span>
            <select value={effectiveReceiver} onChange={(e) => setReceiver(e.target.value)}>
              {store.custodians.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>交接地点</span>
            <input
              placeholder="如：市局物证室"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
          <label>
            <span>交接时间</span>
            <input type="datetime-local" value={handoverAt} onChange={(e) => setHandoverAt(e.target.value)} />
          </label>
          <div className="batch-actions">
            <button onClick={() => setChecked(new Set(filtered.map((s) => s.id)))}>全选当前筛选</button>
            <button onClick={() => setChecked(new Set())}>清空选择</button>
            <button className="primary" onClick={submitBatch}>
              发起整批交接（{checked.size}）
            </button>
          </div>
        </div>
        <Messages result={batchResult} />

        <div className="records custody-list">
          {filtered.length === 0 && <p className="empty">当前筛选下暂无样本。</p>}
          {filtered.map((s, i) => {
            const eligibility = checkHandoverEligibility(s);
            return (
              <article
                key={s.id}
                className={s.id === selectedId ? "active" : ""}
                onClick={() => setSelectedId(s.id)}
              >
                <input
                  type="checkbox"
                  checked={checked.has(s.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggle(s.id)}
                  aria-label={`选择 ${s.id}`}
                />
                <b>{String(i + 1).padStart(2, "0")}</b>
                <div>
                  <h3>
                    {s.id} <span className="stage-tag">{s.stage}</span> <StatusBadge status={s.status} />
                  </h3>
                  <p>
                    {s.species} · {s.location} · 保管人 {s.custodian}
                    {s.caseId ? ` · ${s.caseId}` : " · 未关联案件"}
                  </p>
                </div>
                <span className={`elig ${eligibility.ok ? "pass" : "fail"}`}>
                  {eligibility.ok ? "可交接" : `${eligibility.reasons.length} 项未满足`}
                </span>
              </article>
            );
          })}
        </div>
      </section>

      {selected && <DetailCard store={store} sample={selected} />}

      <section className="panel">
        <div className="heading">
          <div>
            <p>案件样本关联</p>
            <h2>案件列表</h2>
          </div>
        </div>
        <div className="case-grid">
          {store.cases.map((c) => {
            const linked = store.samples.filter((s) => s.caseId === c.id);
            return (
              <article key={c.id} className="case-card">
                <h3>{c.id}</h3>
                <p>{c.title}</p>
                <div className="chips">
                  {linked.length === 0 && <span className="empty">暂无关联样本</span>}
                  {linked.map((s) => (
                    <button key={s.id} onClick={() => setSelectedId(s.id)}>
                      {s.id} · {s.stage}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
          <article className="case-card unlinked">
            <h3>未关联</h3>
            <p>尚未挂接案件的样本，交出前必须完成关联。</p>
            <div className="chips">
              {store.samples.filter((s) => !s.caseId).length === 0 && <span className="empty">无</span>}
              {store.samples
                .filter((s) => !s.caseId)
                .map((s) => (
                  <button key={s.id} onClick={() => setSelectedId(s.id)}>
                    {s.id} · {s.stage}
                  </button>
                ))}
            </div>
          </article>
        </div>
      </section>
    </>
  );
}
