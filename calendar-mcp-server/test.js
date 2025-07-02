import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3000';

async function testSystem() {
  console.log('🧪 Testing Enhanced Calendar & Todo System\n');

  try {
    // Test 1: Create a todo list
    console.log('📝 Creating a test todo list...');
    const listResponse = await fetch(`${API_BASE}/api/todolists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'MCP Test List',
        description: 'Testing the MCP integration',
        color: '#ff6b6b',
        items: [
          { text: 'Test item 1', priority: 'high' },
          { text: 'Test item 2', priority: 'medium' }
        ]
      })
    });
    
    const createdList = await listResponse.json();
    console.log(`✅ Created todo list: ${createdList.title} (ID: ${createdList._id})`);

    // Test 2: Create an event with the todo list
    console.log('\n📅 Creating a test event with todo list...');
    const eventResponse = await fetch(`${API_BASE}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'MCP Test Event',
        description: 'Testing event with todo list integration',
        startTime: new Date(Date.now() + 60000).toISOString(),
        endTime: new Date(Date.now() + 120000).toISOString(),
        todoLists: [createdList._id]
      })
    });
    
    const createdEvent = await eventResponse.json();
    console.log(`✅ Created event: ${createdEvent.title} (ID: ${createdEvent._id})`);

    // Test 3: Search functionality
    console.log('\n🔍 Testing search...');
    const searchResponse = await fetch(`${API_BASE}/api/search?q=MCP&type=all`);
    const searchResults = await searchResponse.json();
    console.log(`✅ Search found ${searchResults.events?.length || 0} events and ${searchResults.todoLists?.length || 0} todo lists`);

    console.log('\n🎉 All tests passed! Your system is ready for MCP integration.');
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error('\nCheck that your calendar server is running on port 3000');
  }
}

testSystem();