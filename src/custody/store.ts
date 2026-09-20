// 保管交接状态：样本/案件数据、当前操作人、localStorage 同步与全部变更入口。
// 所有写操作都经过 rules.ts 的纯规则校验，此处只负责装配与持久化。

import { useEffect, useState } from "react";
import {
  canEdit,
  confirmHandover,
  planBatchHandover,
  returnSample,
  type CaseInfo,
  type CustodyEvent,
  type HandoverPayload,
  type Sample,
  type Stage,
  type TempPoint,
  TEMP_INTERVAL_HOURS,
} from "./rules";

const STORAGE_KEY = "hxyfront-62003:custody:v1";

export const CUSTODIANS = ["陈法医", "王技师", "周警官"];

export interface CustodyState {
  currentUser: string;
  samples: Sample[];
  cases: CaseInfo[];
}

export type ActionResult = { ok: boolean; messages: string[] };

const ok = (...messages: string[]): ActionResult => ({ ok: true, messages });
const fail = (...messages: string[]): ActionResult => ({ ok: false, messages });

// ---- 种子数据：相对当前时间生成，保证温度曲线/交接时间线可读 ----
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function iso(t: number): string {
  return new Date(t).toISOString();
}

function curve(start: number, end: number, base: number, skip: number[] = []): TempPoint[] {
  const pts: TempPoint[] = [];
  let i = 0;
  for (let t = start; t <= end; t += TEMP_INTERVAL_HOURS * HOUR, i++) {
    if (skip.includes(i)) continue;
    const celsius = Math.round((base + Math.sin(i / 3) * 2.4 + (i % 4) * 0.3) * 10) / 10;
    pts.push({ at: iso(t), celsius });
  }
  return pts;
}

function event(at: number, type: CustodyEvent["type"], actor: string, detail: string): CustodyEvent {
  return { at: iso(at), type, actor, detail };
}

function baseSample(partial: Partial<Sample> & Pick<Sample, "id" | "location" | "species" | "stage">): Sample {
  return {
    caseId: null,
    exposureStage: "肿胀期",
    sampledAt: iso(Date.now()),
    preservation: "",
    notes: "",
    temperatureLog: [],
    custodian: CUSTODIANS[0],
    status: "在库",
    returned: false,
    lastHandoverFrom: null,
    pendingHandover: null,
    history: [],
    ...partial,
  };
}

function seed(): CustodyState {
  const now = Date.now();
  const samples: Sample[] = [
    baseSample({
      id: "CASE-042-A",
      caseId: "CASE-042",
      location: "室外草地",
      species: "丝光绿蝇",
      stage: "幼虫",
      exposureStage: "肿胀期",
      sampledAt: iso(now - 3 * DAY),
      preservation: "75%乙醇保存",
      notes: "幼虫三龄，体长约12mm，已拍照固定",
      temperatureLog: curve(now - 3 * DAY, now, 26),
      history: [event(now - 3 * DAY, "创建", "陈法医", "样本登记入库，保管人 陈法医")],
    }),
    baseSample({
      id: "CASE-042-B",
      caseId: "CASE-042",
      location: "阴影区域",
      species: "大头金蝇",
      stage: "蛹",
      exposureStage: "腐烂期",
      sampledAt: iso(now - 4 * DAY),
      preservation: "冷冻保存（-20℃）",
      notes: "需复核种属",
      // 第 5、6 个采样点缺失，形成一段约 18 小时的温度缺档
      temperatureLog: curve(now - 4 * DAY, now, 22, [5, 6]),
      history: [event(now - 4 * DAY, "创建", "陈法医", "样本登记入库，保管人 陈法医")],
    }),
    baseSample({
      id: "CASE-051-A",
      caseId: "CASE-051",
      location: "水沟边缘",
      species: "家蝇",
      stage: "成虫",
      exposureStage: "腐败期",
      sampledAt: iso(now - 2 * DAY),
      preservation: "针插干燥标本",
      notes: "成虫采集，已完成拍照",
      temperatureLog: curve(now - 2 * DAY, now, 24),
      history: [event(now - 2 * DAY, "创建", "陈法医", "样本登记入库，保管人 陈法医")],
    }),
    baseSample({
      id: "CASE-051-B",
      caseId: "CASE-051",
      location: "岸边芦苇丛",
      species: "麻蝇",
      stage: "卵",
      exposureStage: "新鲜期",
      sampledAt: iso(now - 1 * DAY),
      preservation: "",
      notes: "卵块待孵化观察，保存方式待补录",
      temperatureLog: curve(now - 1 * DAY, now, 25),
      history: [event(now - 1 * DAY, "创建", "陈法医", "样本登记入库，保管人 陈法医")],
    }),
    baseSample({
      id: "CASE-058-A",
      caseId: null,
      location: "厂房角落",
      species: "丝光绿蝇",
      stage: "幼虫",
      exposureStage: "腐烂期",
      sampledAt: iso(now - 2 * DAY),
      preservation: "75%乙醇保存",
      notes: "",
      temperatureLog: curve(now - 2 * DAY, now, 27),
      history: [event(now - 2 * DAY, "创建", "陈法医", "样本登记入库，保管人 陈法医")],
    }),
    baseSample({
      id: "CASE-058-B",
      caseId: "CASE-058",
      location: "厂房门口",
      species: "棕尾别麻蝇",
      stage: "蛹",
      exposureStage: "干化期",
      sampledAt: iso(now - 5 * DAY),
      preservation: "冷冻保存（-20℃）",
      notes: "蛹壳完整，已移交王技师复核",
      temperatureLog: curve(now - 5 * DAY, now, 21),
      custodian: "王技师",
      status: "已交接",
      lastHandoverFrom: "陈法医",
      history: [
        event(now - 5 * DAY, "创建", "陈法医", "样本登记入库，保管人 陈法医"),
        event(now - 1 * DAY, "发起交接", "陈法医", "交接给 王技师，地点：市局物证室"),
        event(now - 1 * DAY + 2 * HOUR, "确认接收", "王技师", "于 市局物证室 确认接收，保管权由 陈法医 转移至 王技师"),
      ],
    }),
    baseSample({
      id: "CASE-042-C",
      caseId: "CASE-042",
      location: "树干基部",
      species: "家蝇",
      stage: "成虫",
      exposureStage: "肿胀期",
      sampledAt: iso(now - 6 * DAY),
      preservation: "针插干燥标本",
      notes: "标签模糊，退回复核中",
      temperatureLog: curve(now - 6 * DAY, now, 23),
      custodian: "陈法医",
      status: "待复核",
      returned: true,
      history: [
        event(now - 6 * DAY, "创建", "陈法医", "样本登记入库，保管人 陈法医"),
        event(now - 3 * DAY, "发起交接", "陈法医", "交接给 王技师，地点：市局物证室"),
        event(now - 3 * DAY + 3 * HOUR, "确认接收", "王技师", "于 市局物证室 确认接收，保管权由 陈法医 转移至 王技师"),
        event(now - 2 * DAY, "退回", "王技师", "退回原保管人 陈法医，标记待复核，原因：标签模糊"),
      ],
    }),
  ];
  return {
    currentUser: CUSTODIANS[0],
    samples,
    cases: [
      { id: "CASE-042", title: "城东草地无名尸体案" },
      { id: "CASE-051", title: "河道浮尸案" },
      { id: "CASE-058", title: "废弃厂房高腐尸体案" },
    ],
  };
}

function load(): CustodyState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CustodyState;
    if (!parsed || !Array.isArray(parsed.samples) || !Array.isArray(parsed.cases)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface NewSampleDraft {
  location: string;
  species: string;
  stage: Stage;
  exposureStage: string;
  sampledAt: string;
  preservation: string;
  notes: string;
  temperature: string; // 环境温度，可空
}

export function useCustodyStore() {
  const [state, setState] = useState<CustodyState>(() => load() ?? seed());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 存储不可用时静默降级为内存态
    }
  }, [state]);

  const patchSample = (id: string, fn: (s: Sample) => Sample) =>
    setState((s) => ({ ...s, samples: s.samples.map((it) => (it.id === id ? fn(it) : it)) }));

  const setCurrentUser = (user: string) => setState((s) => ({ ...s, currentUser: user }));

  const addSample = (draft: NewSampleDraft): ActionResult => {
    if (!draft.location.trim()) return fail("采样地点未填写");
    if (!draft.species.trim()) return fail("昆虫种类未填写");
    const sampledAt = draft.sampledAt && !Number.isNaN(+new Date(draft.sampledAt))
      ? new Date(draft.sampledAt).toISOString()
      : new Date().toISOString();
    const now = Date.now();
    const temp = Number(draft.temperature);
    const temperatureLog: TempPoint[] = Number.isFinite(temp) && draft.temperature.trim() !== ""
      ? [{ at: sampledAt, celsius: Math.round(temp * 10) / 10 }]
      : [];
    const id = `SAM-${String(state.samples.length + 1).padStart(3, "0")}`;
    const sample: Sample = {
      id,
      caseId: null,
      location: draft.location.trim(),
      species: draft.species.trim(),
      stage: draft.stage,
      exposureStage: draft.exposureStage.trim() || "未记录",
      sampledAt,
      preservation: draft.preservation.trim(),
      notes: draft.notes.trim(),
      temperatureLog,
      custodian: state.currentUser,
      status: "在库",
      returned: false,
      lastHandoverFrom: null,
      pendingHandover: null,
      history: [
        { at: iso(now), type: "创建", actor: state.currentUser, detail: `样本登记入库，保管人 ${state.currentUser}` },
      ],
    };
    setState((s) => ({ ...s, samples: [...s.samples, sample] }));
    return ok(`样本 ${id} 已登记，保管人：${state.currentUser}`);
  };

  const guardEdit = (id: string): Sample | ActionResult => {
    const sample = state.samples.find((s) => s.id === id);
    if (!sample) return fail("样本不存在");
    if (!canEdit(sample, state.currentUser)) {
      return fail(
        sample.status === "交接中"
          ? "交接确认前双方均不可编辑"
          : `编辑权归当前保管人 ${sample.custodian}，请以该身份操作`
      );
    }
    return sample;
  };

  const updateSample = (
    id: string,
    patch: Partial<Pick<Sample, "location" | "species" | "exposureStage" | "preservation" | "notes" | "stage">>
  ): ActionResult => {
    const guarded = guardEdit(id);
    if ("ok" in guarded) return guarded;
    patchSample(id, (s) => ({
      ...s,
      ...patch,
      history: [
        ...s.history,
        { at: iso(Date.now()), type: "资料修订", actor: state.currentUser, detail: "更新样本基础信息" },
      ],
    }));
    return ok(`样本 ${id} 已更新`);
  };

  const linkCase = (id: string, caseId: string | null): ActionResult => {
    const guarded = guardEdit(id);
    if ("ok" in guarded) return guarded;
    patchSample(id, (s) => ({
      ...s,
      caseId,
      history: [
        ...s.history,
        {
          at: iso(Date.now()),
          type: "资料修订",
          actor: state.currentUser,
          detail: caseId ? `关联案件 ${caseId}` : "解除案件关联",
        },
      ],
    }));
    return ok(caseId ? `样本 ${id} 已关联 ${caseId}` : `样本 ${id} 已解除案件关联`);
  };

  const addTemperature = (id: string, celsius: number): ActionResult => {
    const guarded = guardEdit(id);
    if ("ok" in guarded) return guarded;
    if (!Number.isFinite(celsius)) return fail("温度数值无效");
    const now = Date.now();
    patchSample(id, (s) => ({
      ...s,
      temperatureLog: [...s.temperatureLog, { at: iso(now), celsius: Math.round(celsius * 10) / 10 }],
      history: [
        ...s.history,
        { at: iso(now), type: "记录补录", actor: state.currentUser, detail: `补录温度 ${celsius}℃` },
      ],
    }));
    return ok(`样本 ${id} 已补录 ${celsius}℃`);
  };

  const initiateBatch = (ids: string[], payload: Omit<HandoverPayload, "by">): ActionResult => {
    const result = planBatchHandover(state.samples, ids, { ...payload, by: state.currentUser }, Date.now());
    if (!result.ok) {
      return fail(
        "整批交接失败，本批次全部样本保持原状态：",
        ...result.failures.map((f) => `${f.id}：${f.reasons.join("；")}`)
      );
    }
    setState((s) => ({ ...s, samples: result.samples }));
    return ok(`${ids.length} 份样本已进入交接待确认，等待 ${payload.to} 在 ${payload.location} 接收`);
  };

  const confirm = (id: string): ActionResult => {
    const sample = state.samples.find((s) => s.id === id);
    if (!sample) return fail("样本不存在");
    const result = confirmHandover(sample, state.currentUser);
    if (!result.ok) return fail(...result.reasons);
    patchSample(id, () => result.sample);
    return ok(`样本 ${id} 保管权已转移至 ${state.currentUser}`);
  };

  const returnBack = (id: string, note: string): ActionResult => {
    const sample = state.samples.find((s) => s.id === id);
    if (!sample) return fail("样本不存在");
    const result = returnSample(sample, state.currentUser, note);
    if (!result.ok) return fail(...result.reasons);
    patchSample(id, () => result.sample);
    return ok(`样本 ${id} 已退回原保管人并标记待复核，不得再次转交`);
  };

  const resetAll = (): void => setState(seed());

  return {
    samples: state.samples,
    cases: state.cases,
    currentUser: state.currentUser,
    custodians: CUSTODIANS,
    setCurrentUser,
    addSample,
    updateSample,
    linkCase,
    addTemperature,
    initiateBatch,
    confirm,
    returnBack,
    resetAll,
  };
}

export type CustodyStore = ReturnType<typeof useCustodyStore>;
