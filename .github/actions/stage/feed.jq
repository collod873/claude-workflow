fromjson? | if .type == "assistant" then .message.content[]? |
if .type == "text" then "said: \(.text | split("\n")[0] | .[0:200])"
elif .type == "tool_use" then "\(.name): \(.input | tostring | .[0:200])"
else empty end
elif .type == "result" then "ended \(.subtype) after \(.num_turns) turns, \(.duration_ms / 60000 | floor) min, $\(.total_cost_usd)"
else empty end
