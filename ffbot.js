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
  
  // CORREÇÃO: Lógica de extração de parâmetros flexível, como no seu código original.
  const userID = req.query.userid || req.query.userID || req.query.userId;
  const revenue = req.query.revenue;
  const transactionID = req.query.transactionid || req.query.transactionID || req.query.transactionId;
  const hashRecebido = req.query.hash;
  const tipo = req.query.type;
  const currencyAmount = req.query.currencyAmount;
  
  // CORREÇÃO: Validação mais robusta e menos restritiva.
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
    const userIdLimpo = userID.replace("discord_", "");
    const tipoTarefa = (tipo === 'chargeback') ? 'CHARGEBACK' : 'CREDIT';
    const mensagemTarefa = `${tipoTarefa}:${userIdLimpo}:${usd}`;

    if (!definicoes.canalSeeOfertas) {
      console.error("❌ Erro: O canal de processamento (canalSeeOfertas) não está configurado.");
      return res.status(500).send("Internal Server Error: Processing channel not configured.");
    }

    const canalProcessamento = await client.channels.fetch(definicoes.canalSeeOfertas);
    
    if (canalProcessamento && canalProcessamento.isTextBased()) {
        await canalProcessamento.send(mensagemTarefa);
        console.log(`✅ Tarefa enviada para processamento: ${mensagemTarefa}`);
        return res.status(200).send("1");
    } else {
        console.error(`❌ Erro: Canal de processamento com ID ${definicoes.canalSeeOfertas} não foi encontrado ou não é um canal de texto.`);
        return res.status(500).send("Internal Server Error: Could not find the processing channel.");
    }

  } catch (err) {
    console.error("❌ Erro crítico ao tentar enviar tarefa para o Discord:", err);
    return res.status(500).send("Internal Server Error");
  }
});

// =====================
// Login do Bot e Início do Servidor
// =====================
client.on("ready", () => {
    console.log(`✅ Servidor de postbacks conectado como ${client.user.tag}.`);
    app.listen(PORT, () => {
        console.log(`🚀 Servidor de Postbacks está online na porta ${PORT}`);
    });
});

client.on("error", (error) => {
    console.error("🚨 Erro na conexão do cliente de postbacks:", error);
});

client.login(TOKEN);
