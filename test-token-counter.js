// Simple test to demonstrate token counting
// Using approximation: 1 token ≈ 3.5 characters
function countTokens(text) {
  return Math.ceil(text.length / 3.5);
}

function main() {
  // Test 1: Simple text
  const text1 = 'hello world!';
  const tokens1 = countTokens(text1);
  console.log(`'${text1}' is ${tokens1} tokens (${text1.length} chars)`);

  // Test 2: Larger text
  const text2 = 'The quick brown fox jumps over the lazy dog. '.repeat(100);
  const tokens2 = countTokens(text2);
  console.log(`\nLarge text (${text2.length} chars) is ${tokens2.toLocaleString()} tokens`);

  // Test 3: JSON structure (similar to what we send to LLM)
  const jsonExample = JSON.stringify({
    high_level_goal: "Add a dark mode toggle to the current website",
    plan: [
      "Create a floating toggle button",
      "Implement dark theme CSS variables",
      "Add click handler to toggle themes",
      "Save user preference to localStorage"
    ],
    script: "(function() { console.log('test'); })();",
    css: ".dark { background: black; color: white; }"
  });
  const tokens3 = countTokens(jsonExample);
  console.log(`\nJSON example (${jsonExample.length} chars) is ${tokens3} tokens`);

  // Test 4: Demonstrate the 200k limit
  const maxTokens = 200000;
  console.log(`\n📊 Token Limits:`);
  console.log(`  Max context: ${maxTokens.toLocaleString()} tokens`);
  console.log(`  Reserved for output: 4,000 tokens`);
  console.log(`  Reserved for system: 5,000 tokens`);
  console.log(`  Available for input: ${(maxTokens - 9000).toLocaleString()} tokens`);
}

main();
