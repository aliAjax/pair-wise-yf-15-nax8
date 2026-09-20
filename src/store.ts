// 法医昆虫学样本保管交接 —— 状态与浏览器存储（localStorage + 跨标签页同步）

import { useCallback, useEffect, useState } from "react";
import {
  buildSeries,
  performBatchTransfer,
  performReturn,
  type HandoffDraft,
  type Sample,
  type Stage,
} from "./rules";

const STORAGE_KEY = "forensic-entomology-custody-v1";

export const USERS = ["李明（检材管理员）", "王芳（法医昆虫学鉴定人）", "赵强（实验室接收人）"];

export interface CaseInfo {
  id: string;
  name: string;
}

export const CASES: CaseInfo[] = [
  { id: "CASE-042", name: "城东空地无名尸体案" },
  { id: "CASE-051", name: "水沟边发现遗体案" },
];

export interface NewSampleInput {
  batchNo: string;
  caseId: string;
  location: string;
  exposureStage: string;
  species: string;
  devStage: Stage;
  sampledAt: string;
  preservation: string;
  note: string;
  temps: { t: string; c: number | null }[];
}

export interface AppState {
  samples: Sample[];
  currentUser: string;
}

function seed(): AppState {
  const owner = USERS[0];
  const receiver = USERS[2];

  const s1Start = "2026-09-10T08:00";
  const s2Start = "2026-09-10T09:00";
  const s3Start = "2026-09-11T10:00";
  const s4Start = "2026-09-11T12:00";
  const s5Start = "2026-09-12T07:30";
  const s6Start = "2026-09-13T15:00";
  const s7Start = "2026-09-13T18:00";

  const samples: Sample[] = [
    {
      id: "FE-001",
      batchNo: "B-2026-042-1",
      caseId: "CASE-042",
      location: "城东废弃空地·室外草地",
      exposureStage: "活跃腐烂期",
      species: "丝光绿蝇 Lucilia sericata",
      devStage: "幼虫",
      sampledAt: s1Start,
      preservation: "75% 乙醇浸泡",
      note: "幼虫三龄，体长 12.4mm",
      temps: buildSeries(s1Start, [26.8, 27.9, 28.6, 27.2, 25.4, 23.1]),
      status: "held",
      owner,
      originalOwner: owner,
      review: false,
      events: [],
    },
    {
      id: "FE-002",
      batchNo: "B-2026-042-1",
      caseId: "CASE-042",
      location: "城东废弃空地·阴影区域",
      exposureStage: "活跃腐烂期",
      species: "大头金蝇 Chrysomya megacephala",
      devStage: "蛹",
      sampledAt: s2Start,
      preservation: "", // 保存方式缺失 → 不满足交接条件
      note: "蛹期样本，需复核种属",
      temps: buildSeries(s2Start, [26.1, 27.4, 28.1, 26.8, 25.0, 22.6]),
      status: "held",
      owner,
      originalOwner: owner,
      review: false,
      events: [],
    },
    {
      id: "FE-003",
      batchNo: "B-2026-042-2",
      caseId: "CASE-042",
      location: "城东废弃空地·灌木丛下",
      exposureStage: "后腐烂期",
      species: "家蝇 Musca domestica",
      devStage: "卵",
      sampledAt: s3Start,
      preservation: "75% 乙醇浸泡",
      note: "卵块约 200 粒",
      // 跳过第 3 个记录点 → 12 小时间隔，温度曲线缺档
      temps: buildSeries(s3Start, [25.5, 26.7, 27.0, 26.2, 24.8, 22.9], [3]),
      status: "held",
      owner,
      originalOwner: owner,
      review: false,
      events: [],
    },
    {
      id: "FE-004",
      batchNo: "B-2026-051-1",
      caseId: null, // 未关联案件 → 不满足交接条件
      location: "北郊水沟边缘",
      exposureStage: "肿胀期",
      species: "反吐丽蝇 Calliphora vomitoria",
      devStage: "幼虫",
      sampledAt: s4Start,
      preservation: "-20℃ 冷冻保存",
      note: "幼虫二龄混合样本",
      temps: buildSeries(s4Start, [22.4, 23.0, 23.6, 22.1, 20.8, 19.2]),
      status: "held",
      owner,
      originalOwner: owner,
      review: false,
      events: [],
    },
    {
      id: "FE-005",
      batchNo: "B-2026-051-1",
      location: "北郊水沟边缘·泥地",
      caseId: "CASE-051",
      exposureStage: "肿胀期",
      species: "黄粉甲 Tenebrio molitor",
      devStage: "成虫",
      sampledAt: s5Start,
      preservation: "干燥针插保存",
      note: "已完成拍照，附 4 张生态照",
      temps: buildSeries(s5Start, [21.9, 22.5, 23.1, 22.0, 20.4, 18.8]),
      status: "transferred", // 已交接样本：原保管人失去编辑权，接收人取得
      owner: receiver,
      originalOwner: owner,
      handoff: {
        receiver,
        place: "市局物证中心 3 号交接台",
        time: "2026-09-15T09:30",
      },
      review: false,
      events: [
        {
          kind: "transfer",
          from: owner,
          to: receiver,
          place: "市局物证中心 3 号交接台",
          time: "2026-09-15T09:30",
        },
      ],
    },
    {
      id: "FE-006",
      batchNo: "B-2026-051-2",
      caseId: "CASE-051",
      location: "北郊水沟·上游 20m",
      exposureStage: "新鲜期",
      species: "黑水虻 Hermetia illucens",
      devStage: "卵",
      sampledAt: s6Start,
      preservation: "活体饲养保存",
      note: "曾被接收人退回，待原保管人复核",
      temps: buildSeries(s6Start, [24.2, 24.8, 25.1, 24.0, 22.7, 21.0]),
      status: "review", // 退回样本：归原保管人、待复核、不能再次转交
      owner,
      originalOwner: owner,
      review: true,
      events: [
        {
          kind: "transfer",
          from: owner,
          to: receiver,
          place: "市局物证中心 3 号交接台",
          time: "2026-09-15T10:00",
        },
        {
          kind: "return",
          from: receiver,
          to: owner,
          place: "市局物证中心 3 号交接台",
          time: "2026-09-16T14:20",
        },
      ],
    },
    {
      id: "FE-007",
      batchNo: "B-2026-051-2",
      caseId: "CASE-051",
      location: "北郊水沟·下游 5m",
      exposureStage: "新鲜期",
      species: "厩腐蝇 Muscina stabulans",
      devStage: "成虫",
      sampledAt: s7Start,
      preservation: "75% 乙醇浸泡",
      note: "成虫 3 只，可随批交接",
      temps: buildSeries(s7Start, [23.8, 24.3, 24.9, 23.7, 22.1, 20.5]),
      status: "held",
      owner,
      originalOwner: owner,
      review: false,
      events: [],
    },
  ];

  return { samples, currentUser: owner };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (Array.isArray(parsed.samples) && typeof parsed.currentUser === "string") {
        return parsed;
      }
    }
  } catch {
    /* 存储损坏时回退到种子数据 */
  }
  return seed();
}

export interface StoreApi {
  state: AppState;
  switchUser: (user: string) => void;
  addSample: (input: NewSampleInput) => void;
  updateSample: (id: string, patch: Partial<Sample>) => void;
  transferBatch: (
    ids: string[],
    draft: HandoffDraft
  ) =>
    | { ok: true }
    | {
        ok: false;
        globalError?: string;
        failures: { id: string; batchNo: string; reasons: string[] }[];
      };
  returnSample: (id: string, place: string, time: string) => string | null;
  resetDemo: () => void;
}

let nextSeq = 100;
function nextId(existing: Sample[]): string {
  const max = existing.reduce((m, s) => {
    const n = Number(s.id.replace(/^FE-0*/, ""));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  nextSeq = Math.max(nextSeq, max + 1);
  return `FE-${String(nextSeq++).padStart(3, "0")}`;
}

export function useStore(): StoreApi {
  const [state, setState] = useState<AppState>(load);

  // 写入即持久化到浏览器存储
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 存储不可用时仅保留内存状态 */
    }
  }, [state]);

  // 跨标签页 / 跨窗口同步
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setState(JSON.parse(e.newValue) as AppState);
        } catch {
          /* 忽略无法解析的写入 */
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const switchUser = useCallback((user: string) => {
    setState((s) => ({ ...s, currentUser: user }));
  }, []);

  const addSample = useCallback((input: NewSampleInput) => {
    setState((s) => {
      const id = nextId(s.samples);
      const sample: Sample = {
        id,
        batchNo: input.batchNo.trim() || "B-未编批",
        caseId: input.caseId || null,
        location: input.location.trim(),
        exposureStage: input.exposureStage,
        species: input.species.trim(),
        devStage: input.devStage,
        sampledAt: input.sampledAt,
        preservation: input.preservation,
        note: input.note.trim(),
        temps: input.temps.filter((p) => p.t),
        status: "held",
        owner: s.currentUser,
        originalOwner: s.currentUser,
        review: false,
        events: [],
      };
      return { ...s, samples: [sample, ...s.samples] };
    });
  }, []);

  const updateSample = useCallback((id: string, patch: Partial<Sample>) => {
    setState((s) => ({
      ...s,
      samples: s.samples.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }));
  }, []);

  const transferBatch = useCallback(
    (ids: string[], draft: HandoffDraft) => {
      const res = performBatchTransfer(
        state.samples,
        ids,
        draft,
        state.currentUser
      );
      if (res.ok && res.samples) {
        setState((s) => ({ ...s, samples: res.samples! }));
        return { ok: true as const };
      }
      // 失败：整批保持原状态，不调用 setState
      return {
        ok: false as const,
        globalError: res.globalError,
        failures: res.failures ?? [],
      };
    },
    [state]
  );

  const returnSample = useCallback(
    (id: string, place: string, time: string) => {
      const res = performReturn(
        state.samples,
        id,
        state.currentUser,
        place,
        time
      );
      if (res.ok && res.samples) {
        setState((s) => ({ ...s, samples: res.samples! }));
        return null;
      }
      return res.error ?? "退回失败";
    },
    [state]
  );

  const resetDemo = useCallback(() => {
    setState(seed());
  }, []);

  return {
    state,
    switchUser,
    addSample,
    updateSample,
    transferBatch,
    returnSample,
    resetDemo,
  };
}
