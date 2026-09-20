// 法医昆虫学样本保管交接 —— 业务规则（纯数据、纯函数，不依赖 React / 存储）

export type Stage = "卵" | "幼虫" | "蛹" | "成虫";
export const STAGES: Stage[] = ["卵", "幼虫", "蛹", "成虫"];

export type CustodyStatus = "held" | "transferred" | "review";
export const STATUS_LABEL: Record<CustodyStatus, string> = {
  held: "保管中",
  transferred: "已交接",
  review: "待复核",
};

export const PRESERVATIONS = [
  "75% 乙醇浸泡",
  "干燥针插保存",
  "-20℃ 冷冻保存",
  "活体饲养保存",
];

export const EXPOSURE_STAGES = [
  "新鲜期",
  "肿胀期",
  "活跃腐烂期",
  "后腐烂期",
  "白骨化期",
];

/** 温度曲线按 6 小时间隔记录；相邻记录超过 6.5 小时即视为缺档 */
export const TEMP_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const GAP_LIMIT_MS = 6.5 * 60 * 60 * 1000;
export const MIN_TEMP_POINTS = 2;

export interface TempPoint {
  t: string; // ISO 时间
  c: number | null; // 温度 ℃，null 表示该时刻缺测
}

export interface CustodyEvent {
  kind: "transfer" | "return";
  from: string;
  to: string;
  place: string;
  time: string;
}

export interface Sample {
  id: string;
  batchNo: string; // 同批次编号
  caseId: string | null; // 关联案件
  location: string; // 采样地点
  exposureStage: string; // 尸体暴露阶段
  species: string; // 昆虫种类
  devStage: Stage; // 发育阶段
  sampledAt: string; // 采样时间
  preservation: string; // 保存方式，空串表示保存方式不完整
  note: string; // 鉴定备注
  temps: TempPoint[];
  status: CustodyStatus;
  owner: string; // 当前保管人
  originalOwner: string; // 原保管人（退回接收人）
  handoff?: { receiver: string; place: string; time: string };
  review: boolean; // 待复核标记
  events: CustodyEvent[];
}

export type IssueCode = "preservation" | "temps" | "case" | "status" | "owner";
export interface Issue {
  code: IssueCode;
  label: string;
}

export interface HandoffDraft {
  receiver: string;
  place: string;
  time: string;
}

export interface BatchFailure {
  id: string;
  batchNo: string;
  reasons: string[];
}

export interface BatchResult {
  ok: boolean;
  samples?: Sample[];
  failures?: BatchFailure[];
  globalError?: string;
}

export function sortedPoints(sample: Sample): TempPoint[] {
  return [...sample.temps].sort(
    (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime()
  );
}

/** 温度曲线问题：空数组表示无缺档 */
export function tempProblems(sample: Sample): string[] {
  const problems: string[] = [];
  const pts = sortedPoints(sample);

  if (!sample.sampledAt) {
    problems.push("缺少采样时间，无法核对曲线覆盖范围");
  }
  if (pts.length < MIN_TEMP_POINTS) {
    problems.push(`温度记录不足 ${MIN_TEMP_POINTS} 个点`);
    return problems;
  }
  if (pts.some((p) => p.c === null || Number.isNaN(p.c))) {
    problems.push("存在缺测时刻（空温度值）");
  }
  if (sample.sampledAt) {
    const sampled = new Date(sample.sampledAt).getTime();
    const first = new Date(pts[0].t).getTime();
    if (first - sampled > TEMP_INTERVAL_MS + 5 * 60 * 1000) {
      problems.push("曲线首点晚于采样时间超过一个记录间隔");
    }
  }
  for (let i = 1; i < pts.length; i++) {
    const dt =
      new Date(pts[i].t).getTime() - new Date(pts[i - 1].t).getTime();
    if (dt > GAP_LIMIT_MS) {
      problems.push(
        `第 ${i}–${i + 1} 个记录点间隔 ${(dt / 3600000).toFixed(1)} 小时，存在缺档`
      );
    }
  }
  return problems;
}

/**
 * 交接前置条件：保存方式完整 + 温度曲线无缺档 + 已关联案件；
 * 仅“保管中”且由当前保管人发起；退回待复核样本永久禁止再次转交。
 */
export function sampleBlockers(sample: Sample, currentUser: string): Issue[] {
  const issues: Issue[] = [];

  if (!sample.preservation.trim()) {
    issues.push({ code: "preservation", label: "保存方式不完整" });
  }
  for (const reason of tempProblems(sample)) {
    issues.push({ code: "temps", label: reason });
  }
  if (!sample.caseId) {
    issues.push({ code: "case", label: "未关联案件" });
  }
  if (sample.status === "review") {
    issues.push({
      code: "status",
      label: "退回样本待复核，不能再次转交",
    });
  } else if (sample.status === "transferred") {
    issues.push({ code: "status", label: "样本已交接给接收人" });
  }
  if (sample.owner !== currentUser) {
    issues.push({
      code: "owner",
      label: `仅当前保管人（${sample.owner}）可发起交接`,
    });
  }
  return issues;
}

export function isTransferReady(sample: Sample, currentUser: string): boolean {
  return sampleBlockers(sample, currentUser).length === 0;
}

/** 编辑权：当前保管人可编辑（交接后归接收人；退回后归原保管人） */
export function canEdit(sample: Sample, currentUser: string): boolean {
  return sample.owner === currentUser;
}

/** 退回权：接收人（现持有人）可退回已交接样本 */
export function canReturn(sample: Sample, currentUser: string): boolean {
  return sample.status === "transferred" && sample.owner === currentUser;
}

function withTransferEvent(s: Sample, draft: HandoffDraft): Sample {
  return {
    ...s,
    status: "transferred",
    owner: draft.receiver,
    handoff: { receiver: draft.receiver, place: draft.place, time: draft.time },
    review: false,
    events: [
      ...s.events,
      {
        kind: "transfer",
        from: s.owner,
        to: draft.receiver,
        place: draft.place,
        time: draft.time,
      },
    ],
  };
}

/**
 * 同批次批量交接：任一样本不满足条件则整批保持原状态（事务式，返回原数组引用）。
 */
export function performBatchTransfer(
  all: Sample[],
  ids: string[],
  draft: HandoffDraft,
  operator: string
): BatchResult {
  const targets = ids
    .map((id) => all.find((s) => s.id === id))
    .filter((s): s is Sample => Boolean(s));

  if (targets.length === 0) {
    return { ok: false, globalError: "未选择任何样本" };
  }
  if (!draft.receiver.trim() || !draft.place.trim() || !draft.time) {
    return { ok: false, globalError: "接收人、交接地点与交接时间必须全部确认" };
  }

  const failures: BatchFailure[] = [];
  const batchNos = new Set(targets.map((t) => t.batchNo));
  const crossBatch = batchNos.size > 1;

  for (const t of targets) {
    const reasons = sampleBlockers(t, operator).map((i) => i.label);
    if (crossBatch) reasons.unshift("选择了多个批次，不能合并交接");
    if (reasons.length > 0) {
      failures.push({ id: t.id, batchNo: t.batchNo, reasons });
    }
  }

  // 任一交接失败 → 整批保持原状态，不产生任何变更
  if (failures.length > 0) {
    return { ok: false, failures };
  }

  const idSet = new Set(ids);
  return {
    ok: true,
    samples: all.map((s) => (idSet.has(s.id) ? withTransferEvent(s, draft) : s)),
  };
}

export interface ReturnResult {
  ok: boolean;
  samples?: Sample[];
  error?: string;
}

/** 接收人退回：样本归还原保管人并标记待复核，此后不能再次转交 */
export function performReturn(
  all: Sample[],
  id: string,
  operator: string,
  place: string,
  time: string
): ReturnResult {
  const target = all.find((s) => s.id === id);
  if (!target) return { ok: false, error: "样本不存在" };
  if (!canReturn(target, operator)) {
    return { ok: false, error: "只有持有该样本的接收人可以退回" };
  }
  if (!place.trim() || !time) {
    return { ok: false, error: "退回地点与退回时间必须确认" };
  }

  const returned: Sample = {
    ...target,
    status: "review",
    owner: target.originalOwner,
    handoff: undefined,
    review: true,
    events: [
      ...target.events,
      {
        kind: "return",
        from: operator,
        to: target.originalOwner,
        place,
        time,
      },
    ],
  };
  return { ok: true, samples: all.map((s) => (s.id === id ? returned : s)) };
}

/** 按 6 小时间隔，从采样时间起生成连续温度曲线 */
export function buildSeries(
  startIso: string,
  values: number[],
  skipIndexes: number[] = []
): TempPoint[] {
  const skip = new Set(skipIndexes);
  const start = new Date(startIso).getTime();
  const points: TempPoint[] = [];
  values.forEach((c, i) => {
    if (skip.has(i)) return;
    points.push({
      t: new Date(start + i * TEMP_INTERVAL_MS).toISOString(),
      c,
    });
  });
  return points;
}

export function nowLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
