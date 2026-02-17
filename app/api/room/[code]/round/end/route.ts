import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { pusherServer } from "@/lib/pusher-server";

type Params = { code: string };

export async function POST(req: Request, { params }: { params: Promise<Params> }) {
    const { code } = await params;

    const body = (await req.json().catch(() => null)) as null | { roundId?: string };
    const roundId = (body?.roundId ?? "").trim();
    if (!roundId) return NextResponse.json({ error: "roundId requis" }, { status: 400 });

    const roomKey = `room:${code}`;
    const roomExists = await redis.exists(roomKey);
    if (!roomExists) return NextResponse.json({ error: "Room expirée" }, { status: 404 });

    const ttl = await redis.ttl(roomKey);
    const ttlSeconds = typeof ttl === "number" && ttl > 0 ? ttl : 60 * 60 * 2;

    // idempotent lock
    const lockKey = `room:${code}:roundEnded:${roundId}`;
    const gotLock = await redis.set(lockKey, { endedAt: Date.now() }, { nx: true, ex: ttlSeconds });

    const resultKey = `room:${code}:roundResult:${roundId}`;

    if (!gotLock) {
        const existing = await redis.get(resultKey);
        if (existing) return NextResponse.json(existing);
        return NextResponse.json({ error: "Déjà terminé" }, { status: 409 });
    }

    const roundKey = `room:${code}:round:${roundId}`;
    const round = (await redis.get(roundKey)) as any;
    if (!round) return NextResponse.json({ error: "Manche introuvable" }, { status: 404 });

    const correctIndex: number = round.correctIndex;
    const difficulty: 1 | 2 | 3 = round.difficulty ?? 1;

    const base = 100 * difficulty;
    const duration = round.endsAt - round.answerStartAt;

    const playersSetKey = `room:${code}:players`;
    const playerIds = (await redis.smembers(playersSetKey)) as string[];

    const playerKeys = playerIds.map((id) => `room:${code}:player:${id}`);
    const playersRaw = playerIds.length ? await redis.mget(...playerKeys) : [];

    const answerKeys = playerIds.map((id) => `room:${code}:answer:${roundId}:${id}`);
    const answersRaw = playerIds.length ? await redis.mget(...answerKeys) : [];

    const scoreboardKey = `room:${code}:scores`; // hash: playerId -> score

    const perPlayer = playerIds.map((id, idx) => {
        const p = playersRaw?.[idx] as any;
        const ans = answersRaw?.[idx] as any;

        const choiceIndex = ans?.choiceIndex as number | undefined;
        const answeredAt = ans?.answeredAt as number | undefined;

        const isCorrect = typeof choiceIndex === "number" && choiceIndex === correctIndex;

        let delta = 0;
        if (isCorrect && typeof answeredAt === "number" && duration > 0) {
            const speedRatio = Math.max(0, Math.min(1, (round.endsAt - answeredAt) / duration));
            const speedBonus = Math.round(base * speedRatio);
            delta = base + speedBonus;
        }

        return {
            id,
            name: p?.name ?? "???",
            choiceIndex: typeof choiceIndex === "number" ? choiceIndex : null,
            answeredAt: typeof answeredAt === "number" ? answeredAt : null,
            correct: isCorrect,
            delta,
        };
    });

    for (const r of perPlayer) {
        if (r.delta > 0) {
            await redis.hincrby(scoreboardKey, r.id, r.delta);
        }
    }
    await redis.expire(scoreboardKey, ttlSeconds);

    const scoresHash = (await redis.hgetall(scoreboardKey)) as Record<string, string> | null;

    const leaderboard = perPlayer
        .map((p) => ({
            id: p.id,
            name: p.name,
            score: Number(scoresHash?.[p.id] ?? 0),
        }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

    const payload = {
        roundId,
        correctIndex,
        correctLabel: ["A", "B", "C", "D"][correctIndex] ?? null,
        perPlayer,
        leaderboard,
        endedAt: Date.now(),
    };

    await redis.set(resultKey, payload, { ex: ttlSeconds });
    await pusherServer.trigger(`room-${code}`, "round-ended", payload);

    return NextResponse.json(payload);
}