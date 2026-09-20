// 保管交接业务规则：纯函数，不依赖 React / 浏览器 API。
// 状态机：在库/已交接 --(发起交接)--> 交接中 --(确认接收)--> 已交接 --(退回)--> 待复核（锁定，不得再次转交）

export type Stage = "卵" | "幼虫" | "蛹" | "成虫";
export const STAGES: Stage[] = ["卵", "幼虫", "蛹", "成虫"];

export type CustodyStatus = "在库" | "交接中" | "已交接" | "待复核";
export const CUSTODY_STATUSES: CustodyStatus[] = ["在库", "交接中", "已交接", "待复核"];

export interface TempPoint {
  at: string; // ISO 时间
  celsius: number;
}

export interface PendingHandover {
  to: string;
  location: string;
  at: string; // 约定交接时间 ISO
  by: string; // 发起人（原保管人）
}

export type CustodyEventType =
  | "创建"
  | "发起交接"
  | "确认接收"
  | "退回"
  | "资料修订"
  | "记录补录";

export interface CustodyEvent {
  at: string;
  type: CustodyEventType;
  actor: string;
  detail: string;
}

export interface Sample {
  id: string;
  caseId: string | null;
  location: string; // 采样地点
  species: string; // 昆虫种类
  stage: Stage; // 发育阶段
  exposureStage: string; // 尸体暴露阶段
  sampledAt: string; // 采样时间 ISO
  preservation: string; // 保存方式，空串 = 未记录
  notes: string; // 鉴定备注
  temperatureLog: TempPoint[];
  custodian: string; // 当前保管人（唯一持有编辑权的人）
  status: CustodyStatus;
  returned: boolean; // 是否被退回过（退回后永久禁止再次转交）
  lastHandoverFrom: string | null; // 最近一次交出的原保管人
  pendingHandover: PendingHandover | null;
  history: CustodyEvent[];
}

export interface CaseInfo {
  id: string;
  title: string;
}

// ---- 温度曲线缺档规则：每 6 小时应有一条记录，容忍 2 小时，超过 8 小时视为缺档 ----
export const TEMP_INTERVAL_HOURS = 6;
export const TEMP_TOLERANCE_HOURS = 2;
export const MAX_GAP_MS = (TEMP_INTERVAL_HOURS + TEMP_TOLERANCE_HOURS) * 3_600_000;

export interface TempGap {
  from: string;
  to: string;
}

export function sortedLog(sample: Sample): TempPoint[] {
  return [...sample.temperatureLog].sort((a, b) => +new Date(a.at) - +new Date(b.at));
}

export function findTemperatureGaps(sample: Sample, now: number = Date.now()): TempGap[] {
  const gaps: TempGap[] = [];
  const log = sortedLog(sample);
  if (log.length === 0) {
    gaps.push({ from: sample.sampledAt, to: new Date(now).toISOString() });
    return gaps;
  }
  if (+new Date(log[0].at) - +new Date(sample.sampledAt) > MAX_GAP_MS) {
    gaps.push({ from: sample.sampledAt, to: log[0].at });
  }
  for (let i = 1; i < log.length; i++) {
    if (+new Date(log[i].at) - +new Date(log[i - 1].at) > MAX_GAP_MS) {
      gaps.push({ from: log[i - 1].at, to: log[i].at });
    }
  }
  const last = log[log.length - 1];
  if (now - +new Date(last.at) > MAX_GAP_MS) {
    gaps.push({ from: last.at, to: new Date(now).toISOString() });
  }
  return gaps;
}

// ---- 交接资格：保存方式完整 + 温度曲线无缺档 + 已关联案件 + 未被退回锁定 + 状态允许 ----
export interface Eligibility {
  ok: boolean;
  reasons: string[];
}

export function checkHandoverEligibility(sample: Sample, now: number = Date.now()): Eligibility {
  const reasons: string[] = [];
  if (!sample.preservation.trim()) reasons.push("保存方式未记录");
  const gaps = findTemperatureGaps(sample, now);
  if (gaps.length > 0) reasons.push(`温度曲线存在 ${gaps.length} 处缺档`);
  if (!sample.caseId) reasons.push("未关联案件");
  if (sample.returned || sample.status === "待复核") {
    reasons.push("已退回样本待复核，不得再次转交");
  } else if (sample.status === "交接中") {
    reasons.push("交接待确认，不能重复发起");
  }
  return { ok: reasons.length === 0, reasons };
}

// ---- 编辑权：当前保管人持有；交接确认前（交接中）双方均不可编辑 ----
export function canEdit(sample: Sample, user: string): boolean {
  return sample.custodian === user && sample.status !== "交接中";
}

export interface HandoverPayload {
  to: string;
  location: string;
  at: string;
  by: string;
}

export type RuleResult = { ok: true; sample: Sample } | { ok: false; reasons: string[] };

function pushEvent(sample: Sample, event: CustodyEvent): Sample {
  return { ...sample, history: [...sample.history, event] };
}

// 校验发起交接（不改动数据），供单条与批次共用
export function validateHandover(
  sample: Sample,
  payload: HandoverPayload,
  now: number = Date.now()
): string[] {
  const reasons: string[] = [];
  if (sample.custodian !== payload.by) reasons.push("仅当前保管人可发起交接");
  if (!payload.to.trim()) reasons.push("接收人未填写");
  else if (payload.to === sample.custodian) reasons.push("接收人不能与当前保管人相同");
  if (!payload.location.trim()) reasons.push("交接地点未填写");
  if (!payload.at || Number.isNaN(+new Date(payload.at))) reasons.push("交接时间无效");
  reasons.push(...checkHandoverEligibility(sample, now).reasons);
  return reasons;
}

export function applyInitiate(sample: Sample, payload: HandoverPayload, now: number): Sample {
  const next: Sample = {
    ...sample,
    status: "交接中",
    pendingHandover: { to: payload.to, location: payload.location, at: payload.at, by: payload.by },
  };
  return pushEvent(next, {
    at: new Date(now).toISOString(),
    type: "发起交接",
    actor: payload.by,
    detail: `交接给 ${payload.to}，地点：${payload.location}`,
  });
}

export function initiateHandover(
  sample: Sample,
  payload: HandoverPayload,
  now: number = Date.now()
): RuleResult {
  const reasons = validateHandover(sample, payload, now);
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, sample: applyInitiate(sample, payload, now) };
}

// ---- 确认接收：仅指定接收人可确认；确认后保管权（编辑权）转移 ----
export function confirmHandover(sample: Sample, by: string, now: number = Date.now()): RuleResult {
  if (sample.status !== "交接中" || !sample.pendingHandover) {
    return { ok: false, reasons: ["当前无待确认的交接"] };
  }
  if (sample.pendingHandover.to !== by) {
    return { ok: false, reasons: [`仅指定接收人 ${sample.pendingHandover.to} 可确认接收`] };
  }
  const pending = sample.pendingHandover;
  const next: Sample = {
    ...sample,
    custodian: pending.to,
    status: "已交接",
    lastHandoverFrom: pending.by,
    pendingHandover: null,
  };
  return {
    ok: true,
    sample: pushEvent(next, {
      at: new Date(now).toISOString(),
      type: "确认接收",
      actor: by,
      detail: `于 ${pending.location} 确认接收，保管权由 ${pending.by} 转移至 ${by}`,
    }),
  };
}

// ---- 退回：仅当前保管人（接收方）可退回；退回后归原保管人、标记待复核、不得再次转交 ----
export function returnSample(
  sample: Sample,
  by: string,
  note: string,
  now: number = Date.now()
): RuleResult {
  if (sample.status !== "已交接") return { ok: false, reasons: ["仅已交接样本可退回"] };
  if (sample.custodian !== by) return { ok: false, reasons: ["仅当前保管人可退回样本"] };
  const backTo = sample.lastHandoverFrom ?? sample.custodian;
  const next: Sample = {
    ...sample,
    custodian: backTo,
    status: "待复核",
    returned: true,
    lastHandoverFrom: null,
    pendingHandover: null,
  };
  return {
    ok: true,
    sample: pushEvent(next, {
      at: new Date(now).toISOString(),
      type: "退回",
      actor: by,
      detail: `退回原保管人 ${backTo}，标记待复核${note.trim() ? `，原因：${note.trim()}` : ""}`,
    }),
  };
}

// ---- 批次交接：任一失败则整批保持原状态（先全量校验，通过后才应用） ----
export type BatchResult =
  | { ok: true; samples: Sample[] }
  | { ok: false; failures: { id: string; reasons: string[] }[] };

export function planBatchHandover(
  samples: Sample[],
  ids: string[],
  payload: HandoverPayload,
  now: number = Date.now()
): BatchResult {
  if (ids.length === 0) {
    return { ok: false, failures: [{ id: "（未选择样本）", reasons: ["请先勾选要交接的样本"] }] };
  }
  const byId = new Map(samples.map((s) => [s.id, s]));
  const failures: { id: string; reasons: string[] }[] = [];
  for (const id of ids) {
    const sample = byId.get(id);
    if (!sample) {
      failures.push({ id, reasons: ["样本不存在"] });
      continue;
    }
    const reasons = validateHandover(sample, payload, now);
    if (reasons.length > 0) failures.push({ id, reasons });
  }
  if (failures.length > 0) return { ok: false, failures };
  const idSet = new Set(ids);
  return {
    ok: true,
    samples: samples.map((s) => (idSet.has(s.id) ? applyInitiate(s, payload, now) : s)),
  };
}
