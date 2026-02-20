#!/bin/bash
# ============================================
# CryptoSwap Backend - Deploy Script
# Run on your Hetzner VPS (Ubuntu 24.04)
# ============================================

set -e

echo "🚀 Starting CryptoSwap Backend Setup..."

# 1. Update system
echo "📦 Updating system..."
apt update && apt upgrade -y

# 2. Install Node.js 20 LTS
echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. Install PM2 (process manager)
echo "📦 Installing PM2..."
npm install -g pm2

# 4. Create app directory
echo "📁 Creating app directory..."
mkdir -p /opt/cryptoswap-backend
cd /opt/cryptoswap-backend

# 5. Copy files (you'll do this via SCP before running this script)
# The following files should already be in /opt/cryptoswap-backend:
#   - server.js
#   - package.json
#   - .env

# 6. Install dependencies
echo "📦 Installing dependencies..."
npm install --production

# 7. Setup firewall
echo "🔒 Configuring firewall..."
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw --force enable

# 8. Install Nginx (reverse proxy)
echo "📦 Installing Nginx..."
apt install -y nginx

# 9. Configure Nginx as reverse proxy
echo "⚙️ Configuring Nginx..."
cat > /etc/nginx/sites-available/cryptoswap <<'EOF'
server {
    listen 80;
    server_name _;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Block everything that's not /api/
    location / {
        return 404;
    }
}
EOF

ln -sf /etc/nginx/sites-available/cryptoswap /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# 10. Start backend with PM2
echo "🚀 Starting backend with PM2..."
cd /opt/cryptoswap-backend
pm2 start server.js --name cryptoswap-api
pm2 save
pm2 startup systemd -u root --hp /root

echo ""
echo "✅ Deploy complete!"
echo "🔒 Backend running on port 3001 (behind Nginx on port 80)"
echo "🌐 Test: curl http://YOUR_SERVER_IP/api/get-deposit-address"
echo ""
echo "📝 Next steps:"
echo "  1. Point a domain to this server's IP"
echo "  2. Run: certbot --nginx -d yourdomain.com (for HTTPS)"
echo "  3. Update ALLOWED_ORIGIN in .env to your frontend domain"
echo "  4. pm2 restart cryptoswap-api"
