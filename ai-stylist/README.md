# AI Stylist branch

Add these files to a separate feature branch.

Required environment variable:

OPENAI_API_KEY

Optional:

OPENAI_STYLIST_MODEL=gpt-5.6-luna

The implementation uses the OpenAI Responses API over fetch; no SDK dependency is required.

The stylist receives only wardrobe/profile/weather/rotation information required for styling. It is explicitly instructed not to override FitCheck's deterministic fit engine.

Keep this branch separate from production until reviewed.