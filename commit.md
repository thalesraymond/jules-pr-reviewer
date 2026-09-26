test: 🧪 [testing improvement] Use AuthError for permissions issues

🎯 **What:**
The `wrapPermissionError` function was returning standard `Error` objects
and returning non-matching errors instead of throwing them.
We updated it to strictly return `AuthError` (to improve downstream
tracking based on `kind: "auth"`) and explicitly throw any non-matching
input errors.

📊 **Coverage:**
The unit tests in `tests/jules.test.ts` have been updated to check for
`AuthError` instantiation, verify the message properties (`kind`), and
explicitly check that non-applicable errors are thrown.

✨ **Result:**
Test assertions are more explicit, covering object types and property
kinds, leading to higher confidence in our authentication error routing
layer.
