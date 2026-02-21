import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { pusherServer } from "@/lib/pusher-server";
import { QUESTIONS } from "@/lib/question-bank";

type Params = { code: string };

// 🔁 Sélectionne la prochaine question de la room, dans l'ordre du tableau QUESTIONS
async function pickNextQuestionForRoom(code: string) {
    const idxKey = `room:${code}:questionIndex`;
    const raw = await redis.get(idxKey);

    let idx = 0;
    if (typeof raw === "string") {
        const parsed = parseInt(raw, 10);
        if (!Number.isNaN(parsed)) idx = parsed;
    }

    if (idx >= QUESTIONS.length) {
        // plus de questions disponibles
        return { question: null, nextIndex: idx };
    }

    const question = QUESTIONS[idx];
    const nextIndex = idx + 1;

    // on enregistre le prochain index pour la future manche
    await redis.set(idxKey, String(nextIndex));

    return { question, nextIndex };
}

export async function POST(_req: Request, { params }: { params: Promise<Params> }) {
    const { code } = await params;

    const roomKey = `room:${code}`;
    const roomExists = await redis.exists(roomKey);
    if (!roomExists) {
        return NextResponse.json({ error: "Room introuvable ou expirée" }, { status: 404 });
    }

    // ⬇️ Sélection séquentielle
    const { question } = await pickNextQuestionForRoom(code);

    if (!question) {
        // plus de questions : on renvoie une 409 pour que le host sache que la partie est finie
        return NextResponse.json(
            { error: "Plus de questions disponibles pour cette room." },
            { status: 409 }
        );
    }

    const now = Date.now();
    const sequenceStartAt = now + 1000; // 1s de marge avant de démarrer l’écoute

    // ⏱ calcul dynamique des durées (comme on l’a fait juste avant)
    const questionMs = question.questionDuration * 1000;
    const optionsMs =
        question.optionDurations && question.optionDurations.length === question.optionUrls.length
            ? question.optionDurations.reduce((acc, v) => acc + v * 1000, 0)
            : 0;

    // 3s entre chaque réponse (A→B, B→C, C→D)
    const gapsMs = (question.optionUrls.length - 1) * 3000;

    const listeningTotalMs = questionMs + optionsMs + gapsMs;

    const answerStartAt = sequenceStartAt + listeningTotalMs;
    const answerWindowMs = 10_000;
    const endsAt = answerStartAt + answerWindowMs;

    const roundId = `${code}-${now}`;

    const roundPayload = {
        roundId,
        difficulty: question.difficulty,
        questionUrl: question.questionUrl,
        optionUrls: question.optionUrls,
        answerUrl: question.answerUrl,
        sequenceStartAt,
        answerStartAt,
        endsAt,
    };

    const roundKey = `room:${code}:round:${roundId}`;
    await redis.set(
        roundKey,
        {
            ...roundPayload,
            correctIndex: question.correctIndex,
            createdAt: now,
        },
        { ex: 60 * 60 }
    );

    await pusherServer.trigger(`room-${code}`, "round-started", roundPayload);

    return NextResponse.json(roundPayload);
}