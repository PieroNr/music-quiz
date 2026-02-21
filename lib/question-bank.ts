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
    },{
        id: "q2",
        difficulty: 1,
        questionUrl: "/audio/q2_question.mp3",
        questionDuration: 19.2,           // par ex. 7.4s
        optionUrls: [
            "/audio/q2_A.mp3",
            "/audio/q2_B.mp3",
            "/audio/q2_C.mp3",
            "/audio/q2_D.mp3",
        ],
        optionDurations: [6, 5.4, 5.4, 5.6], // en secondes
        correctIndex: 0,
        answerUrl: "/audio/q2_reponse.mp3",
    },{
        id: "q3",
        difficulty: 1,
        questionUrl: "/audio/q3_question.mp3",
        questionDuration: 20.2,           // par ex. 7.4s
        optionUrls: [
            "/audio/q3_A.mp3",
            "/audio/q3_B.mp3",
            "/audio/q3_C.mp3",
            "/audio/q3_D.mp3",
        ],
        optionDurations: [6.2, 5.5, 5.8, 5.8], // en secondes
        correctIndex: 1,
        answerUrl: "/audio/q3_reponse.mp3",
    },{
        id: "q4",
        difficulty: 1,
        questionUrl: "/audio/q4_question.mp3",
        questionDuration: 21.4,           // par ex. 7.4s
        optionUrls: [
            "/audio/q4_A.mp3",
            "/audio/q4_B.mp3",
            "/audio/q4_C.mp3",
            "/audio/q4_D.mp3",
        ],
        optionDurations: [6.2, 5.3, 6.1, 5.6], // en secondes
        correctIndex: 2,
        answerUrl: "/audio/q4_reponse.mp3",
    },{
        id: "q5",
        difficulty: 1,
        questionUrl: "/audio/q5_question.mp3",
        questionDuration: 16,           // par ex. 7.4s
        optionUrls: [
            "/audio/q5_A.mp3",
            "/audio/q5_B.mp3",
            "/audio/q5_C.mp3",
            "/audio/q5_D.mp3",
        ],
        optionDurations: [5.8, 5.3, 5.6, 5.4], // en secondes
        correctIndex: 1,
        answerUrl: "/audio/q5_reponse.mp3",
    }
];