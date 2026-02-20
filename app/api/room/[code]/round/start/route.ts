import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { pusherServer } from "@/lib/pusher-server";
import { QUESTIONS } from "@/lib/question-bank"; // adapte le chemin si besoin

type Params = { code: string };

function pickQuestion() {
    // à adapter selon ta logique (random / séquence / index)
    const idx = Math.floor(Math.random() * QUESTIONS.length);
    return QUESTIONS[idx];
}

export async function POST(_req: Request, { params }: { params: Promise<Params> }) {
    const { code } = await params;

    const roomKey = `room:${code}`;
    const roomExists = await redis.exists(roomKey);
    if (!roomExists) {
        return NextResponse.json({ error: "Room introuvable ou expirée" }, { status: 404 });
    }

    const question = pickQuestion();

    const now = Date.now();
    const sequenceStartAt = now + 1000; // 1s de marge avant de démarrer l’écoute

    // ✅ Durée totale de l’écoute (question + réponses + gaps)
    const questionMs = question.questionDuration * 1000;
    const optionsMs =
        question.optionDurations && question.optionDurations.length === question.optionUrls.length
            ? question.optionDurations.reduce((acc, v) => acc + v * 1000, 0)
            : 0;

    const gapsMs = (question.optionUrls.length - 1) * 3000; // 3s entre chaque réponse (A→B, B→C, C→D)

    const listeningTotalMs = questionMs + optionsMs + gapsMs;

    const answerStartAt = sequenceStartAt + listeningTotalMs; // ✅ le timer 10s commence après toute l’écoute
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

    // On stocke la manche en cours pour /round/end
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

    // Temps réel pour host + joueurs
    await pusherServer.trigger(`room-${code}`, "round-started", roundPayload);

    return NextResponse.json(roundPayload);
}