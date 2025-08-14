// =====================
// Importação de Dependências
// =====================
const { Client, GatewayIntentBits, Partials, REST, Routes, PermissionsBitField } = require("discord.js");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const express  = require("express");
const crypto   = require("crypto");

// =====================
// Configuração das Variáveis de Ambiente
// =====================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// =====================
// Caminhos dos Arquivos de Dados
// =====================
const ficheiroResgates = path.join(__dirname, "resgates.json");
const ficheiroDepositos = path.join(__dirname, "depositos.json");
const ficheiroDadosFF = path.join(__dirname, "dadosFF.json");
const ficheiroDefinicoes = path.join(__dirname, "definicoes.json");
const ficheiroLucro = path.join(__dirname, "lucro.json");
const ficheiroCodigosRef = path.join(__dirname, "codigos_ref.json");
const ficheiroBlacklistRef = path.join(__dirname, "blacklist_ref.json");
const ficheiroLoja = path.join(__dirname, "loja.json");
const ficheiroApostas = path.join(__dirname, "apostas.json"); // Novo ficheiro para apostas
const ficheiroPurchaseCount = path.join(__dirname, "purchaseCount.json");

// =====================
// Funções de Persistência
// =====================
function carregarResgates() {
    if (fs.existsSync(ficheiroResgates)) {
        return JSON.parse(fs.readFileSync(ficheiroResgates, "utf8"));
    }
    return {};
}

function carregarDepositos() {
    if (fs.existsSync(ficheiroDepositos)) {
        return JSON.parse(fs.readFileSync(ficheiroDepositos, "utf8"));
    }
    return {};
}

function guardarResgates(data) {
    fs.writeFileSync(ficheiroResgates, JSON.stringify(data, null, 2));
}

function guardarDepositos(data) {
    fs.writeFileSync(ficheiroDepositos, JSON.stringify(data, null, 2));
}

function carregarDadosFF() {
    if (fs.existsSync(ficheiroDadosFF)) {
        return JSON.parse(fs.readFileSync(ficheiroDadosFF, "utf8"));
    }
    return {};
}

function guardarDadosFF(data) {
    fs.writeFileSync(ficheiroDadosFF, JSON.stringify(data, null, 2));
}

let definicoes = {};
if (fs.existsSync(ficheiroDefinicoes)) {
    definicoes = JSON.parse(fs.readFileSync(ficheiroDefinicoes, "utf8"));
}
// garantia de estrutura:
definicoes.equipes = definicoes.equipes || {
  A: { lider: null, membro: null, adschannel: null },
  B: { lider: null, membro: null, adschannel: null },
  C: { lider: null, membro: null, adschannel: null },
};
definicoes.idCargoRegistrado = definicoes.idCargoRegistrado || null;
definicoes.idCargoNaoRegistrado = definicoes.idCargoNaoRegistrado || null;
definicoes.donationChannel = definicoes.donationChannel || null;
function guardarDefinicoes() {
    fs.writeFileSync(ficheiroDefinicoes, JSON.stringify(definicoes, null, 2));
}

// Carregar o lucro do server
function carregarLucro() {
    if (fs.existsSync(ficheiroLucro)) {
        let stats = JSON.parse(fs.readFileSync(ficheiroLucro, "utf8"));
        if (stats.lucro === undefined) stats.lucro = 0;
        if (stats.dinheiroFFserver === undefined) stats.dinheiroFFserver = 0;
        return stats;
    }
    return { lucro: 0, dinheiroFFserver: 0 };
}

function guardarLucro(stats) {
    fs.writeFileSync(ficheiroLucro, JSON.stringify(stats, null, 2));
}


// ===============================
// SERVER POSTBACKS
// ===============================

// Configurações e "Secrets" do Replit
const TIMEWALL = process.env.TIMEWALL;


const app = express();
const PORT = 3001;

// Mensagem no site
app.get("/", (req, res) => {
  res.status(200).send("Bot e Servidor de Postbacks estão online!");
});

// ——————— TimeWall Postback Webhook ———————
app.get("/timewall-postback", async (req, res) => {
  console.log("🔔 TimeWall postback recebido:", req.query);
  
  const userID = req.query.userid || req.query.userID || req.query.userId;
  const revenue = req.query.revenue;
  const revenueUSD = parseFloat(revenue);
  const currencyAmount = req.query.currencyAmount;
  const currencyAmountUSD = parseFloat(currencyAmount);
  const transactionID = req.query.transactionid || req.query.transactionID || req.query.transactionId;
  const hashRecebido = req.query.hash;
  const tipo = req.query.type;

  
  if (!userID || isNaN(revenueUSD) || !transactionID || !hashRecebido) {
    console.error("❌ TimeWall: Parâmetros em falta ou inválidos.", req.query);
    return res.status(400).send("Missing parameters");
  }

  const hashEsperada = crypto.createHash("sha256").update(userID + revenueUSD + TIMEWALL).digest("hex");
 
  if (hashRecebido !== hashEsperada) {
  console.error("⛔ TimeWall hash inválida. Fórmula usada: transactionID + secret");
  console.error("   - Hash Recebido:", hashRecebido);
  console.error("   - Hash Esperado:", hashEsperada);
  console.error("   - TransactionID:", transactionID);
  return res.status(403).send("Invalid hash");
  }
  try {
  const usd = currencyAmountUSD;
  const userIdLimpo = (userID || "").replace("discord_", "");
    
  console.log(`✅ Postback TimeWall [${tipo}] para ${userIdLimpo}: +${usd} RL'$`);

  try {
    if (definicoes.canalSeeOfertas && tipo === "credit") {
      const canalSeeOfertas = await client.channels.fetch(definicoes.canalSeeOfertas);
      if (canalSeeOfertas?.isTextBased()) {
        await canalOfertas.send(`{userIdLimpo} +${usd} RL'$`);
        console.log(`📢 Mensagem enviada para o canal de ofertas`);
      } else if (definicoes.canalSeeOfertas && tipo === "chargeback") {
          await canalOfertas.send(`{userIdLimpo} ${usd} RL'$`); 
    }
  } catch (canalError) {
    console.warn("⚠️ Erro ao enviar no canal de ofertas:", canalError.message);
  }
  return res.status(200).send("1");
} catch (err) {
  console.error("❌ Erro ao processar o postback da TimeWall:", err);
  return res.status(500).send("Processing error");
  }
});


// Inicia o servidor web
app.listen(PORT, () => {
  console.log(`🚀 Servidor de Postbacks está online na porta ${PORT}`);
});
              
// =====================
// Tratamento de Erros e Eventos de Conexão
// =====================
client.on("error", (error) => {
    console.error("🚨 Erro na conexão com o Discord:", error);
});

client.on("disconnect", () => {
    console.warn("⚠️ Bot desconectado! Aguardando reconexão...");
});

client.on("reconnecting", () => {
    console.log("🔄 Tentando reconectar ao Discord...");
});

client.on("ready", async () => {
    console.log("✅ Bot conectado com sucesso!");
    if (!aVerificarOperacoes) {
        aVerificarOperacoes = true;
        await verificarOperacoesPendentes();
        aVerificarOperacoes = false;
    }
});

client.on("resume", async () => {
    console.log("✅ Conexão restaurada! Verificando operações pendentes...");
    if (!aVerificarOperacoes) {
        aVerificarOperacoes = true;
        await verificarOperacoesPendentes();
        aVerificarOperacoes = false;
    }
});

client.on("shardResume", async (shardId, replayed) => {
    console.log(`Shard ${shardId} resumed. Replayed ${replayed} events.`);
});

client.on("shardDisconnect", async (event, shardId) => {
    console.warn(`Shard ${shardId} disconnected: ${event.reason}`);
    if (!aVerificarOperacoes) {
        aVerificarOperacoes = true;
        await verificarOperacoesPendentes();
        aVerificarOperacoes = false;
    }
});

// =====================
// Login do Bot
// =====================
client.login(TOKEN);
