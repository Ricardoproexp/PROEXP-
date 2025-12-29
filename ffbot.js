// =====================
// Importação de Dependências
// =====================
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// =====================
// Configuração das Variáveis de Ambiente
// =====================
const TOKEN = process.env.TOKEN;
const TIMEWALL = process.env.TIMEWALL;

// Telegram (opcional - apenas se quiser processar telegram_)
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;

// =====================
// Caminhos dos Arquivos de Dados
// =====================
const ficheiroDefinicoes = path.join(__dirname, "definicoes.json");

// =====================
// Funções de Persistência
// =====================
let definicoes = {};
if (fs.existsSync(ficheiroDefinicoes)) {
    definicoes = JSON.parse(fs.readFileSync(ficheiroDefinicoes, "utf8"));
}
definicoes.canalSeeOfertas = definicoes.canalSeeOfertas || null;

// =====================
// Configuração do Cliente Discord
// =====================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ],
    partials: [Partials.Channel],
});

// =====================
// Configuração do Bot Telegram (APENAS SE CONFIGURADO)
// =====================
let botTelegram = null;
if (TELEGRAM_TOKEN && TELEGRAM_GROUP_ID) {
    try {
        const { Telegraf } = require("telegraf");
        botTelegram = new Telegraf(TELEGRAM_TOKEN);
        
        botTelegram.launch().then(() => {
            console.log(`🤖 Bot Telegram conectado como ${botTelegram.botInfo.username}`);
        }).catch(error => {
            console.error(`❌ Erro ao conectar bot Telegram: ${error.message}`);
            botTelegram = null;
        });
    } catch (error) {
        console.warn("⚠️ Telegram não disponível - módulo telegraf não instalado");
        console.log("📦 Para usar Telegram, instale: npm install telegraf");
        botTelegram = null;
    }
}

// ===============================
// SERVER POSTBACKS
// ===============================
const app = express();
const PORT = 3001;

app.get("/", (req, res) => {
  res.status(200).send("Servidor de Postbacks está online!");
});

app.get("/timewall-postback", async (req, res) => {
  console.log("🔔 TimeWall postback recebido:", req.query);
  
  // Lógica de extração de parâmetros (MESMA DO ORIGINAL)
  const userID = req.query.userid || req.query.userID || req.query.userId;
  const revenue = req.query.revenue;
  const transactionID = req.query.transactionid || req.query.transactionID || req.query.transactionId;
  const hashRecebido = req.query.hash;
  const tipo = req.query.type;
  const currencyAmount = req.query.currencyAmount;
  
  // Validação (MESMA DO ORIGINAL)
  if (!userID || !revenue || !transactionID || !hashRecebido || !tipo || !currencyAmount || isNaN(parseFloat(revenue)) || isNaN(parseFloat(currencyAmount))) {
    console.error("❌ TimeWall: Parâmetros em falta ou inválidos.", req.query);
    return res.status(400).send("Missing or invalid parameters");
  }

  const revenueUSD = parseFloat(revenue);
  const hashEsperada = crypto.createHash("sha256").update(userID + revenueUSD + TIMEWALL).digest("hex");
 
  if (hashRecebido !== hashEsperada) {
    console.error("⛔ TimeWall hash inválida.");
    return res.status(403).send("Invalid hash");
  }

  try {
    const usd = parseFloat(currencyAmount);
    
    // DETECTAR PLATAFORMA PELO userID
    if (userID.startsWith('discord_')) {
      // ✅ PROCESSAR PARA DISCORD (COMPORTAMENTO ORIGINAL)
      await processarParaDiscord(userID, tipo, usd, transactionID);
      return res.status(200).send("1");
      
    } else if (userID.startsWith('telegram_')) {
      // 🤖 PROCESSAR PARA TELEGRAM (SE CONFIGURADO)
      if (botTelegram && TELEGRAM_GROUP_ID) {
        await processarParaTelegram(userID, tipo, usd, transactionID);
        return res.status(200).send("1");
      } else {
        console.error("❌ Telegram não configurado para userID:", userID);
        return res.status(500).send("Telegram not configured");
      }
      
    } else {
      // 🔄 FALLBACK: Assumir Discord (compatibilidade com versão antiga)
      console.warn(`⚠️ userID sem prefixo: ${userID}, assumindo Discord`);
      await processarParaDiscord(`discord_${userID}`, tipo, usd, transactionID);
      return res.status(200).send("1");
    }

  } catch (err) {
    console.error("❌ Erro crítico ao processar postback:", err);
    return res.status(500).send("Internal Server Error");
  }
});

// =====================
// FUNÇÃO PARA DISCORD (100% IGUAL ORIGINAL)
// =====================
async function processarParaDiscord(userID, tipo, usd, transactionID) {
    const userIdLimpo = userID.replace("discord_", "");
    const tipoTarefa = (tipo === 'chargeback') ? 'CHARGEBACK' : 'CREDIT';
    const mensagemTarefa = `${tipoTarefa}:${userIdLimpo}:${usd}`;

    if (!definicoes.canalSeeOfertas) {
        console.error("❌ Erro: O canal de processamento (canalSeeOfertas) não está configurado.");
        throw new Error("Processing channel not configured");
    }

    const canalProcessamento = await client.channels.fetch(definicoes.canalSeeOfertas);
    
    if (canalProcessamento && canalProcessamento.isTextBased()) {
        await canalProcessamento.send(mensagemTarefa);
        console.log(`✅ Tarefa Discord enviada para processamento: ${mensagemTarefa}`);
    } else {
        console.error(`❌ Erro: Canal de processamento com ID ${definicoes.canalSeeOfertas} não foi encontrado ou não é um canal de texto.`);
        throw new Error("Could not find the processing channel");
    }
}

// =====================
// FUNÇÃO PARA TELEGRAM (NOVA)
// =====================
async function processarParaTelegram(userID, tipo, usd, transactionID) {
    if (!botTelegram || !TELEGRAM_GROUP_ID) {
        throw new Error("Telegram not configured");
    }
    
    const userIdLimpo = userID.replace("telegram_", "");
    const tipoTarefa = (tipo === 'chargeback') ? 'CHARGEBACK' : 'CREDIT';
    
    try {
        const mensagemTelegram = `🔔 *Nova Tarefa Processada*\n\n` +
                                `📱 Plataforma: *Telegram*\n` +
                                `👤 User ID: \`${userIdLimpo}\`\n` +
                                `📊 Tipo: *${tipoTarefa}*\n` +
                                `💰 Valor: *${usd.toFixed(4)} RL\\'\\$*\n` +
                                `🆔 Transação: \`${transactionID}\`\n` +
                                `⏰ Hora: ${new Date().toLocaleString('pt-PT')}`;
        
        const sentMessage = await botTelegram.telegram.sendMessage(
            TELEGRAM_GROUP_ID,
            mensagemTelegram,
            { parse_mode: 'Markdown' }
        );
        
        console.log(`✅ Tarefa Telegram enviada: ${tipoTarefa}:${userIdLimpo}:${usd}`);
        console.log(`📨 Mensagem ID no Telegram: ${sentMessage.message_id}`);
        
        // Aguardar 5 segundos e reagir com 👍 (como no Discord)
        setTimeout(async () => {
            try {
                // Telegram não tem "reactions" como Discord, então podemos:
                // 1. Enviar uma mensagem de confirmação
                // 2. Ou editar a mensagem original
                
                // Opção 1: Enviar mensagem de confirmação
                await botTelegram.telegram.sendMessage(
                    TELEGRAM_GROUP_ID,
                    `✅ Processado: ${tipoTarefa}:${userIdLimpo}:${usd.toFixed(4)}`,
                    { reply_to_message_id: sentMessage.message_id }
                );
                
                console.log(`👍 Confirmação enviada para Telegram`);
                
            } catch (error) {
                console.error(`❌ Erro ao enviar confirmação Telegram: ${error.message}`);
            }
        }, 5000); // 5 segundos como no Discord
        
    } catch (error) {
        console.error(`❌ Erro ao enviar mensagem para Telegram: ${error.message}`);
        throw error;
    }
}

// =====================
// SISTEMA DE REAÇÃO PARA DISCORD (100% IGUAL)
// =====================
client.on("messageCreate", async (message) => {
    // Ignorar mensagens do próprio bot
    if (message.author.bot && message.author.id === client.user.id) {
        // Verificar se é uma mensagem de tarefa no formato: TIPO:USERID:VALOR
        const parts = message.content.split(':');
        if (parts.length === 3) {
            const [tipo, userId, valorStr] = parts;
            const valor = parseFloat(valorStr);
            
            if ((tipo === 'CREDIT' || tipo === 'CHARGEBACK') && !isNaN(valor)) {
                console.log(`📨 Tarefa do bot detectada: ${message.content}`);
                
                // Aguardar 5 segundos e reagir (MESMO DO ORIGINAL)
                setTimeout(async () => {
                    try {
                        await message.react('✅');
                        console.log(`✅ Reação adicionada à tarefa: ${tipo}:${userId}:${valor}`);
                    } catch (error) {
                        console.error(`❌ Erro ao adicionar reação: ${error.message}`);
                    }
                }, 5000);
            }
        }
    }
});

// =====================
// Login do Bot e Início do Servidor
// =====================
client.on("ready", () => {
    console.log(`✅ Bot Discord conectado como ${client.user.tag}.`);
    
    // Verificar se canal de processamento está configurado
    if (definicoes.canalSeeOfertas) {
        console.log(`📁 Canal de processamento: ${definicoes.canalSeeOfertas}`);
    } else {
        console.warn(`⚠️ ATENÇÃO: canalSeeOfertas não configurado!`);
    }
    
    // Verificar Telegram
    if (botTelegram) {
        console.log(`🤖 Telegram configurado para grupo: ${TELEGRAM_GROUP_ID}`);
    }
    
    app.listen(PORT, () => {
        console.log(`🚀 Servidor de Postbacks está online na porta ${PORT}`);
        console.log(`🌐 Endpoint principal: /timewall-postback`);
        console.log(`🎯 Aceita: discord_xxx e telegram_xxx`);
    });
});

client.on("error", (error) => {
    console.error("🚨 Erro na conexão do Discord:", error);
});

// Graceful shutdown
process.once('SIGINT', () => {
    console.log('🛑 Desligando graciosamente...');
    if (botTelegram) {
        botTelegram.stop('SIGINT');
    }
    client.destroy();
    process.exit(0);
});

process.once('SIGTERM', () => {
    console.log('🛑 Terminando graciosamente...');
    if (botTelegram) {
        botTelegram.stop('SIGTERM');
    }
    client.destroy();
    process.exit(0);
});

client.login(TOKEN);
