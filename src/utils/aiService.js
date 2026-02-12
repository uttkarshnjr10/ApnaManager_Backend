const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('./logger');

// 1. Debug Log: Check if Key exists (Don't print the full key for security)
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('❌ CRITICAL: GEMINI_API_KEY is missing in .env file!');
} else {
  console.log(`✅ Gemini Service Initialized (Key ends with: ...${apiKey.slice(-4)})`);
}

const genAI = new GoogleGenerativeAI(apiKey);

const generateDailySummary = async (stats, role) => {
  try {
    // 2. Use 'gemini-pro' if flash fails, or stick to 'gemini-1.5-flash'
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    let roleSpecificInstruction = '';

    // 3. Handle Role Context
    if (role === 'Regional Admin') {
      roleSpecificInstruction = `
                Act as a System Administrator for a Government Portal.
                Your goal is to summarize system activity for the Regional Administrator.
                Tone: Official, concise, administrative.
            `;
    } else if (role === 'Hotel') {
      roleSpecificInstruction = `
                Act as a Hotel Manager's Assistant.
                Your goal is to give a daily briefing to the Hotel Owner.
                Tone: Helpful, business-oriented, welcoming.
            `;
    }

    // 4. EDGE CASE HANDLING: Check for Zero Data
    // If everything is zero, we give a specific instruction so the AI doesn't hallucinate.
    const isQuietDay = stats.totalGuests === 0;
    const quietDayInstruction = isQuietDay
      ? 'Note: There is zero recorded activity today. Keep the summary very brief (1 sentence) stating the system is active but quiet.'
      : '';

    const prompt = `
            ${roleSpecificInstruction}
            ${quietDayInstruction}

            Analyze these daily stats:
            - Total New Guests: ${stats.totalGuests || 0}
            - Top Guest Cities: ${stats.topCities?.length > 0 ? stats.topCities.join(', ') : 'None'}
            - Visit Purposes: ${stats.topPurposes?.length > 0 ? stats.topPurposes.join(', ') : 'None'}
            - Foreign Guests: ${stats.foreignNationals || 0}
            ${stats.policeSearches !== undefined ? `- Police Searches: ${stats.policeSearches}` : ''}

            Write a 3-sentence summary. Do not use markdown. Keep it plain text.
        `;

    console.log(`🤖 Sending Prompt to AI (${role}):`, prompt.substring(0, 100) + '...'); // Log first 100 chars

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log('✅ AI Response Received:', text); // Log success
    return text.trim();
  } catch (error) {
    // 5. DETAILED ERROR LOGGING
    console.error('❌ AI SERVICE CRASHED:');
    console.error('   Message:', error.message);
    if (error.response) console.error('   API Response:', error.response);

    return 'Daily analysis is currently unavailable (Check Server Logs).';
  }
};

module.exports = { generateDailySummary };
