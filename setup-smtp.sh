#!/bin/bash

echo "🚀 Setting up Listmonk with Mailpit SMTP..."

# Wait for Listmonk to be ready
echo "⏳ Waiting for Listmonk to be ready..."
while ! curl -f http://localhost:9000/health &>/dev/null; do
    echo "   Waiting for Listmonk..."
    sleep 2
done
echo "✅ Listmonk is ready!"

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
sleep 5

# Configure SMTP settings for Mailpit
echo "🔧 Configuring SMTP settings..."

# Force update SMTP settings in database to match Mailpit
docker-compose exec -T db psql -U listmonk -d listmonk -c "
UPDATE settings 
SET value = '[{\"name\": \"Mailpit SMTP\", \"uuid\": \"\", \"host\": \"mailpit\", \"port\": 1025, \"enabled\": true, \"password\": \"\", \"tls_type\": \"none\", \"username\": \"\", \"max_conns\": 10, \"idle_timeout\": \"15s\", \"wait_timeout\": \"5s\", \"auth_protocol\": \"none\", \"email_headers\": [], \"hello_hostname\": \"\", \"max_msg_retries\": 2, \"tls_skip_verify\": false}]'
WHERE key = 'smtp';
" > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo "✅ SMTP settings updated in database"
    
    # Restart Listmonk to load new settings
    echo "🔄 Restarting Listmonk to apply SMTP settings..."
    docker-compose restart listmonk > /dev/null 2>&1
    
    # Wait for restart
    echo "⏳ Waiting for Listmonk to restart..."
    sleep 10
    
    # Wait for health check
    while ! curl -f http://localhost:9000/health &>/dev/null; do
        echo "   Waiting for Listmonk restart..."
        sleep 2
    done
    
    echo ""
    echo "🎉 Setup completed successfully!"
    echo ""
    echo "🎯 Development environment is ready:"
    echo "   📧 Listmonk Admin: http://localhost:9000/admin"
    echo "   📨 Mailpit Web UI: http://localhost:8025"
    echo "   🐘 PostgreSQL: localhost:5432"
    echo ""
    echo "📖 Credentials:"
    echo "   Admin username: admin"
    echo "   Admin password: listmonk"
    echo ""
    echo "💡 You can now send test emails and they will appear in Mailpit!"
else
    echo "❌ Failed to configure SMTP settings"
    echo "Please check the logs: docker-compose logs"
    exit 1
fi
