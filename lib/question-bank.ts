// src/data/questions.ts

export type Question = {
    id: string;
    difficulty: 1 | 2 | 3;
    questionUrl: string;
    questionDuration: number;   // ✅ durée en secondes
    optionUrls: string[];       // A / B / C / D
    optionDurations: number[];  // ✅ durées en secondes, même ordre que optionUrls
    correctIndex: 0 | 1 | 2 | 3;
    answerUrl: string;
};

export const QUESTIONS: Question[] = [
    {
        id: "q1",
        difficulty: 1,
        questionUrl: "/audio/q1_question.mp3",
        questionDuration: 30.5,           // par ex. 7.4s
        optionUrls: [
            "/audio/q1_A.mp3",
            "/audio/q1_B.mp3",
            "/audio/q1_C.mp3",
            "/audio/q1_D.mp3",
        ],
        optionDurations: [5.6, 5, 4.9, 5.3], // en secondes
        correctIndex: 3,
        answerUrl: "/audio/q1_reponse.mp3",
    },
    // ...
];