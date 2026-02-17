export type QuestionItem = {
    id: string;
    difficulty: 1 | 2 | 3;
    questionUrl: string;
    optionUrls: [string, string, string, string]; // A,B,C,D
    correctIndex: 0 | 1 | 2 | 3;
};

export const QUESTION_BANK: QuestionItem[] = [
    {
        id: "q1",
        difficulty: 1,
        questionUrl: "/audio/q1_question.mp3",
        optionUrls: [
            "/audio/q1_A.mp3",
            "/audio/q1_B.mp3",
            "/audio/q1_C.mp3",
            "/audio/q1_D.mp3",
        ],
        correctIndex: 2,
    },
];