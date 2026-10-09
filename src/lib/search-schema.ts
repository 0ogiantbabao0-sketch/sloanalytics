import { z } from "zod";
import { validDate } from "./calendar";
const date = z
  .string()
  .refine(
    (s) => validDate(s) && s >= "1970-01-01" && s <= "2050-12-31",
    "日付は1970〜2050年の範囲で指定してください",
  );
export const searchSchema = z
  .object({
    mode: z.enum(["demo", "real"]),
    center: z.object({
      name: z.string().max(200),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
    radius: z.number().min(5).max(100),
    transport: z.enum(["train", "car", "both"]),
    targetDate: date,
    targetEnd: z.union([z.literal(""), date]),
    days: z.number().int().min(1).max(3660),
    from: z.union([z.literal(""), date]),
    to: z.union([z.literal(""), date]),
    conditions: z.object({
      digits: z.array(z.number().int().min(0).max(9)).max(10),
      monthDays: z.array(z.number().int().min(1).max(31)).max(31),
      weekdays: z.array(z.number().int().min(0).max(6)).max(7),
      dayGroup: z.enum(["", "weekdays", "weekend", "off"]),
      doubles: z.boolean(),
      minStreak: z.union([
        z.literal(0),
        z.literal(3),
        z.literal(4),
        z.literal(5),
      ]),
      streakPosition: z.enum(["", "first", "middle", "last"]),
      streakIndex: z.number().int().min(0).max(15),
      special: z.boolean(),
      eventType: z.enum(["", "any", "visit", "coverage", "other"]),
      eventText: z.string().max(100),
      join: z.enum(["AND", "OR"]),
    }),
    rankingMode: z.enum(["auto", "machine", "hall"]),
    machineIds: z.array(z.string().max(100)).max(100),
    hallId: z.string().max(100),
    bestOnly: z.boolean(),
    sort: z.enum([
      "score",
      "avg",
      "positiveRate",
      "confidence",
      "days",
      "distance",
    ]),
    comparePrevious: z.boolean(),
  })
  .refine(
    (s) => !s.targetEnd || s.targetEnd >= s.targetDate,
    "対象日の終了が開始より前です",
  )
  .refine(
    (s) =>
      !!s.from === !!s.to &&
      (!s.from || (s.from <= s.to && s.to < s.targetDate)),
    "任意期間は開始・終了を指定し、対象日より前にしてください",
  )
  .refine(
    (s) => s.rankingMode !== "machine" || !!s.machineIds.length,
    "機種を1つ以上選択してください",
  )
  .refine(
    (s) => s.rankingMode !== "hall" || !!s.hallId,
    "ホールを選択してください",
  );
