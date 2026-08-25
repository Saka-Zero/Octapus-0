# Octapus-0 🐙

Multi-provider AI CLI with smart fallback. Connect to **Groq**, **Gemini**, **Ollama**, **OpenRouter**, **Requesty** — automatically falls back when one fails.

## Features

- 🔄 **Smart Fallback** — Groq → Gemini → Ollama → OpenRouter → Requesty
- 🆓 **Free Tier First** — Prioritizes free providers (Groq, Gemini, Ollama)
- ⚡ **Streaming** — Real-time token streaming
- 🔧 **Multi-Provider** — 5 providers out of the box, extensible
- 💰 **Cost Tracking** — Token usage & cost estimation
- 🎯 **Model Management** — List, filter, test providers
- 🔐 **Secure Config** — API keys stored in `~/.config/octapus/config.yaml` (chmod 600)

## Quick Start

```bash
# Install
npm install -g octapus-0
# or from source:
git clone https://github.com/Saka-Zero/Octapus-0
cd Octapus-0 && npm install && npm run build && npm link

# Configure API keys (at least one)
octapus config set providers.groq.apiKey "gsk_xxx"
octapus config set providers.gemini.apiKey "AIza_xxx"
octapus config set providers.openrouter.apiKey "sk-or-xxx"
octapus config set providers.requesty.apiKey "sk-xxx"

# Enable providers
octapus provider enable groq
octapus provider enable gemini

# Chat!
octapus chat "Hello, Octapus!"
octapus chat -m gemini-1.5-pro-latest "Explain TypeScript generics"
```

## Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `chat <prompt>` | `c` | Chat with AI |
| `models` | `m` | List available models |
| `provider <sub>` | `p` | Manage providers |
| `config <sub>` | `cfg` | Manage configuration |

### Chat Options

```bash
octapus chat "prompt"                    # Default model
octapus chat -m llama-3.1-70b "prompt"   # Specific model
octapus chat -s "You are a poet" "prompt" # System prompt
octapus chat --no-stream "prompt"        # Disable streaming
octapus chat --no-fallback "prompt"      # Disable fallback
```

### Provider Management

```bash
octapus provider enable groq      # Enable provider
octapus provider disable gemini   # Disable provider
octapus provider test             # Test all enabled
octapus provider test groq        # Test specific
octapus provider priority groq 10 # Set priority (higher = first)
octapus provider add custom https://api.example.com/v1 -k "key" -p 5
```

### Config Management

```bash
octapus config list               # Show all (masked)
octapus config list --plain       # Show all (unmasked)
octapus config get providers.groq.apiKey
octapus config set providers.groq.apiKey "gsk_xxx"
octapus config set defaultModel "gemini-1.5-pro-latest"
octapus config path               # Show config file path
octapus config edit               # Open in editor
octapus config reset --yes        # Reset to defaults
```

## Providers

| Provider | Free Tier | Models | Priority |
|----------|-----------|--------|----------|
| **Groq** | ✅ Generous | Llama 3.1 70B/8B, Gemma 2, Mixtral | 10 |
| **Gemini** | ✅ 1.5M tokens/min | Gemini 1.5 Pro/Flash | 8 |
| **Ollama** | ✅ Unlimited (local) | Any GGUF model | 5 |
| **OpenRouter** | $1 free credit | 100+ models | 3 |
| **Requesty** | Free tier | GPT-4o-mini, Claude Haiku | 2 |

## Configuration

Config file: `~/.config/octapus/config.yaml`

```yaml
providers:
  groq:
    apiKey: "gsk_xxx"
    priority: 10
    enabled: true
  gemini:
    apiKey: "AIza_xxx"
    priority: 8
    enabled: true
  ollama:
    baseURL: "http://localhost:11434"
    priority: 5
    enabled: true
  openrouter:
    apiKey: "sk-or-xxx"
    priority: 3
    enabled: false
  requesty:
    apiKey: "sk-xxx"
    priority: 2
    enabled: false

defaultModel: "llama-3.1-70b-versatile"
fallbackModels:
  - "gemini-1.5-flash-latest"
  - "llama-3.1-8b-instant"
  - "mixtral-8x7b-32768"

settings:
  temperature: 0.7
  maxTokens: 4096
  stream: true
  showCost: true
  showTokens: true
```

## Getting API Keys

| Provider | Get Key |
|----------|---------|
| **Groq** | https://console.groq.com/keys |
| **Gemini** | https://aistudio.google.com/apikey |
| **OpenRouter** | https://openrouter.ai/keys |
| **Requesty** | https://requesty.ai/keys |
| **Ollama** | `ollama serve` (local, no key) |

## Development

```bash
# Clone
git clone https://github.com/Saka-Zero/Octapus-0
cd Octapus-0

# Install
npm install

# Build
npm run build

# Dev mode (ts-node)
npm run dev chat "test"

# Link globally
npm link

# Run tests
npm test
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        octapus CLI                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  Config     │  │  Router     │  │  Provider   │         │
│  │  Manager    │──│  (Fallback) │──│  Adapters   │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│        │                │                │                  │
│        ▼                ▼                ▼                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  ~/.config  │  │  Strategy:  │  │  Groq       │         │
│  │  /octapus   │  │  - Priority │  │  Gemini     │         │
│  │  /config.yaml│  │  - Fallback │  │  Ollama     │         │
│  │             │  │  - Cost opt │  │  OpenRouter │         │
│  └─────────────┘  └─────────────┘  │  Requesty   │         │
│                                    └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

## License

MIT © Saka-Zero