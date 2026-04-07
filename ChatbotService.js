import { GoogleGenerativeAI } from '@google/generative-ai';

export class ChatbotService {
    constructor() {
        this.genAI = null;
        this.model = null;
        this.chatSession = null;
        this.isReady = false;

        // In Vite, environment variables are exposed via import.meta.env
        this.apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    }

    init() {
        if (!this.apiKey) {
            console.error('[Gemini Service] Missing VITE_GEMINI_API_KEY in .env.local');
            return false;
        }

        try {
            this.genAI = new GoogleGenerativeAI(this.apiKey);

            // System instructions give Gemini a persona for the hackathon
            const systemInstruction = `
You are the interactive AI Guitar Coach for the "Guitar Chord Coach" web application built for a hackathon.
Your tone should be encouraging, concise, and highly knowledgeable about music theory, specifically for beginners.
Keep your answers under 3 short paragraphs.
Use emojis sparingly but effectively.
Format your responses in markdown (bolding key terms, using bullet points).

If asked about the app, explain that it uses Computer Vision to track the guitar fretboard and hand skeletal landmarks to grade the user's chord fingering, as well as an Audio DSP Engine to listen for chords like Em, C, G, D, Am.
            `.trim();

            this.model = this.genAI.getGenerativeModel({
                model: "gemini-2.5-flash",
                systemInstruction: systemInstruction,
            });

            // Start an empty chat session with history
            this.chatSession = this.model.startChat({
                history: [
                    {
                        role: "user",
                        parts: [{ text: "Hello! I'm using the Guitar Chord Coach." }],
                    },
                    {
                        role: "model",
                        parts: [{ text: "Welcome! I'm your AI Guitar Coach. Do you have any questions about fingering, music theory, or the chords we're practicing today?" }],
                    }
                ]
            });

            this.isReady = true;
            return true;
        } catch (error) {
            console.error('[Gemini Service] Failed to initialize:', error);
            return false;
        }
    }

    async sendMessage(text) {
        if (!this.isReady || !this.chatSession) {
            return "Error: Chatbot is not initialized.";
        }

        try {
            const result = await this.chatSession.sendMessage(text);
            return result.response.text();
        } catch (error) {
            console.error('[Gemini Service] Message failed:', error);
            return "Sorry, I'm having trouble connecting to the Google AI servers right now.";
        }
    }
}
