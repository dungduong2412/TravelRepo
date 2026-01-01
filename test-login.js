// Test login functionality
const fetch = require('node-fetch');

async function testLogin() {
  console.log('Testing login endpoint...\n');
  
  // Test cases
  const tests = [
    { email: 'merchant@test.com', password: 'password123', userType: 'merchant' },
    { email: 'collaborator@test.com', password: 'password123', userType: 'collaborator' },
  ];
  
  for (const test of tests) {
    console.log(`Testing ${test.userType} login: ${test.email}`);
    try {
      const response = await fetch('http://localhost:3000/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(test),
      });
      
      const data = await response.json();
      console.log(`Status: ${response.status}`);
      console.log('Response:', JSON.stringify(data, null, 2));
      console.log('---\n');
    } catch (error) {
      console.log('Error:', error.message);
      console.log('---\n');
    }
  }
}

testLogin();
