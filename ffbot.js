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

// Taxa de comissão (fee)
const taxaComissao = 0.00035; // 0,035% de comissão

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



// ===============================
// SERVER POSTBACKS
// ===============================

// Configurações e "Secrets" do Replit
const MYLEAD = process.env.MYLEAD;
const TIMEWALL = process.env.TIMEWALL;

// ===============================
// SERVER POSTBACKS
// ===============================

const app = express();
const PORT = 3001;

// Rota principal para UptimeRobot e testes manuais
app.get("/", (req, res) => {
  res.status(200).send("Bot e Servidor de Postbacks estão online!");
});

// ——————— TimeWall Postback Webhook ———————
app.get("/timewall-postback", async (req, res) => {
  console.log("🔔 TimeWall postback recebido:", req.query);
  
  // Leitura robusta dos parâmetros, aceitando vários formatos
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

  // CORREÇÃO: Usar a variável correta TIMEWALL
  const hashEsperada = crypto.createHash("sha256").update(userID + revenueUSD + TIMEWALL).digest("hex");
 
  if (hashRecebido !== hashEsperada) {
  console.error("⛔ TimeWall hash inválida. Fórmula usada: transactionID + secret");
  console.error("   - Hash Recebido:", hashRecebido);
  console.error("   - Hash Esperado:", hashEsperada);
  console.error("   - TransactionID:", transactionID);
  return res.status(403).send("Invalid hash");
  }
  try {
    const sats = await usdToSats(currencyAmountUSD);
    const dados = carregarDadosFF();
    const userIdLimpo = userID.replace('discord_', '');
    
    dados[userIdLimpo] = dados[userIdLimpo] || { dinheiro: 0, ganhosdetarefas: 0, vitorias: 0, derrotas: 0 };
    dados[userIdLimpo].dinheiro += sats;
    dados[userIdLimpo].ganhosdetarefas = (dados[userIdLimpo].ganhosdetarefas || 0) + sats;
    
    guardarDadosFF(dados);
    console.log(`✅ Postback TimeWall [${tipo}] para ${userIdLimpo}: +${sats} sats`);

    const definicoes = carregarDefinicoes();
    try {
    const user = await client.users.fetch(userIdLimpo);
    if (user) {
        await user.send(`🎉 Você recebeu uma recompensa! **+${sats} sats** foram adicionados ao seu saldo. Seu novo saldo é **${dados[userIdLimpo].dinheiro} sats**.`);
        console.log(`📨 Notificação por DM enviada com sucesso para ${userIdLimpo}.`);
    } 
  } if (definicoes.canalOfertas) {
      try {
        const offersChan = await client.channels.fetch(definicoes.canalOfertas);
        if (offersChan?.isTextBased()) {
          offersChan.send(
            `🎉 <@${userIdLimpo}> recebeu **+${sats} sats** na TimeWall!`
          );
        }
      } catch (err) {
        console.error("⚠️ Erro ao notificar canal de ofertas:", err);
      }
    }

    return res.status(200).send("1");
  } catch (err) {
    console.error("❌ Erro ao processar o postback da TimeWall:", err.message);
    return res.status(500).send("Processing error");
  }
});

// ——————— MyLead Postback Webhook ———————
app.get("/mylead-postback", async (req, res) => {
  console.log("🔔 MyLead postback recebido:", req.query);

  const userID       = req.query.player_id;
  const payoutEUR    = parseFloat(req.query.payout_decimal);
  const status       = req.query.status;
  const receivedHash = req.get("X-MyLead-Security-Hash");

  if (status !== "approved" || !userID || isNaN(payoutEUR) || !receivedHash) {
    console.error("❌ MyLead: Parâmetros inválidos ou em falta.", req.query);
    return res.status(400).send("Invalid");
  }
  
  const urlNoHash = req.originalUrl.split('&X-MyLead-Security-Hash=')[0];
  // CORREÇÃO: Usar a variável correta MYLEAD
  const expected  = crypto.createHmac("sha256", MYLEAD).update(urlNoHash).digest("hex");
  
  if (!crypto.timingSafeEqual(Buffer.from(receivedHash), Buffer.from(expected))) {
    console.error("⛔ MyLead Hash mismatch", { recebido: receivedHash, esperado: expected });
    return res.status(403).send("Forbidden");
  }

  const payoutUSD = 1.15 * payoutEUR;
  try {
    const creditSats = await usdToSats(payoutUSD);
    const dados = carregarDadosFF();
    
    dados[userID] = dados[userID] || { dinheiro: 0, vitorias: 0, derrotas: 0, ganhosdetarefas: 0 };
    dados[userID].dinheiro += creditSats;
    dados[userID].ganhosdetarefas = (dados[userID].ganhosdetarefas || 0) + creditSats;

    guardarDadosFF(dados);
    console.log(`✅ MyLead lead aprovada para ${userID}: +${creditSats} sats (EUR ${payoutEUR})`);
    
    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Erro ao processar o postback da MyLead:", err.message);
    res.status(500).send("Processing error");
  }
});


// Inicia o servidor web
app.listen(PORT, () => {
  console.log(`🚀 Servidor de Postbacks está online na porta ${PORT}`);
});




// ====================
// USD TO SATOSHIS
// =====================
async function usdToSats(usd) {
  try {
    const res = await axios.get("https://api.mempool.space/api/v1/prices", {
      timeout: 8000 // Timeout de 8 segundos para robustez
    });
    if (!res.data || !res.data.USD) {
      throw new Error("Resposta inválida da API mempool.space");
    }
    const btc_usd = res.data.USD;
    const sats_per_usd = 100_000_000 / btc_usd;
    return Math.round(usd * sats_per_usd);
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      console.error("❌ Erro na API de preços: TIMEOUT.");
    } else {
      console.error("❌ Erro na API de preços:", error.message);
    }
    throw error;
  }
}


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

// ========== Códigos de Referência ==========
function carregarCodigosRef() {
    if (fs.existsSync(ficheiroCodigosRef)) {
        return JSON.parse(fs.readFileSync(ficheiroCodigosRef, "utf8"));
    }
    return {}; // Estrutura: { codigo: { proprietario: userId, referidos: [userId, ...] } }
}

function guardarCodigosRef(data) {
    fs.writeFileSync(ficheiroCodigosRef, JSON.stringify(data, null, 2));
}

function carregarBlacklistRef() {
    if (fs.existsSync(ficheiroBlacklistRef)) {
        return JSON.parse(fs.readFileSync(ficheiroBlacklistRef, "utf8"));
    }
    return []; // Lista de userIds banidos
}

function guardarBlacklistRef(lista) {
    fs.writeFileSync(ficheiroBlacklistRef, JSON.stringify(lista, null, 2));
}

// Função para gerar um código de referência aleatório (8 caracteres, por exemplo)
function gerarCodigoRefAleatorio(comprimento = 8) {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let resultado = '';
    for (let i = 0; i < comprimento; i++) {
        resultado += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    return resultado;
}

// Retorna o userId do referenciador se o utilizador dado foi referenciado, caso contrário, null.
function obterReferenciador(userId) {
    let codigosRef = carregarCodigosRef();
    for (const codigo in codigosRef) {
        if (codigosRef[codigo].referidos.includes(userId)) {
            return codigosRef[codigo].proprietario;
        }
    }
    return null;
}

// Função que gera o próximo ID para a rifa
function obterProximoIdRifa() {
    const ficheiros = fs.readdirSync(__dirname);
    let idMaximo = 0;
    ficheiros.forEach(ficheiro => {
        const correspondencia = ficheiro.match(/^rifa\((\d+)\)\.json$/);
        if (correspondencia) {
            const id = parseInt(correspondencia[1]);
            if (id > idMaximo) idMaximo = id;
        }
    });
    return idMaximo + 1;
}

function carregarPurchaseCount() {
  if (fs.existsSync(ficheiroPurchaseCount)) {
    return JSON.parse(fs.readFileSync(ficheiroPurchaseCount, "utf8")).lastId;
  }
  return 0;
}

function guardarPurchaseCount(id) {
  fs.writeFileSync(
    ficheiroPurchaseCount,
    JSON.stringify({ lastId: id }, null, 2)
  );
}

// =====================
// Funções de Persistência para a Loja
// =====================

function carregarLoja() {
    if (fs.existsSync(ficheiroLoja)) {
        return JSON.parse(fs.readFileSync(ficheiroLoja, "utf8"));
    }
    return {}; // Estrutura: { itemId: { name, price, quantity } }
}

function guardarLoja(data) {
    fs.writeFileSync(ficheiroLoja, JSON.stringify(data, null, 2));
}

// Função para obter o próximo ID de item da loja
function obterProximoIdItemLoja() {
    const dadosLoja = carregarLoja();
    const idsItens = Object.keys(dadosLoja).map(Number);
    if (idsItens.length === 0) {
        return 1;
    }
    return Math.max(...idsItens) + 1;
}

// =====================
// Funções de Persistência para as Apostas
// =====================

function carregarApostas() {
    if (fs.existsSync(ficheiroApostas)) {
        return JSON.parse(fs.readFileSync(ficheiroApostas, "utf8"));
    }
    return {}; // Estrutura: { apostaId: { ...dados da aposta... } }
}

function guardarApostas(data) {
    fs.writeFileSync(ficheiroApostas, JSON.stringify(data, null, 2));
}

// =====================
// Configuração do Cliente Discord
// =====================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
});

// =====================
// Configuração da Blink Wallet API
// =====================
const blinkApiKey = process.env.BLINK_API_KEY;
const walletId = "a7905a0a-1c87-49c6-9480-ecf639788ffd"; // Substitua pelo seu wallet ID

// =====================
// Funções de Integração com a Blink API
// =====================
async function criarFatura(quantidadeSatoshis) {
    try {
        const resposta = await axios.post(
            "https://api.blink.sv/graphql",
            {
                query: `
          mutation lnInvoiceCreate($input: LnInvoiceCreateInput!) {
            lnInvoiceCreate(input: $input) {
              invoice {
                paymentRequest
                paymentHash
                paymentSecret
                satoshis
              }
              errors {
                message
              }
            }
          }
        `,
                variables: {
                    input: {
                        amount: quantidadeSatoshis.toString(),
                        walletId: walletId,
                        expiresIn: 2,
                    },
                },
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "X-API-KEY": blinkApiKey,
                },
            }
        );
        if (resposta.data.errors) {
            console.error("Erro ao criar fatura:", resposta.data.errors);
            return null;
        }
        return resposta.data.data.lnInvoiceCreate.invoice;
    } catch (erro) {
        console.error("Erro na conexão com a Blink API:", erro.response ? erro.response.data : erro.message);
        return null;
    }
}

async function verificarEstadoPagamento(pedidoPagamento) {
    try {
        const resposta = await axios.post(
            "https://api.blink.sv/graphql",
            {
                query: `
          query paymentsWithProof($first: Int) {
            me {
              defaultAccount {
                transactions(first: $first) {
                  edges {
                    node {
                      initiationVia {
                        ... on InitiationViaLn {
                          paymentRequest
                          paymentHash
                        }
                      }
                      settlementVia {
                        ... on SettlementViaLn {
                          preImage
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
                variables: { first: 10 },
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "X-API-KEY": blinkApiKey,
                },
            }
        );
        if (resposta.data.errors) {
            console.error("Erro ao verificar pagamento:", resposta.data.errors);
            return false;
        }
        const transacoes = resposta.data.data.me.defaultAccount.transactions.edges;
        for (const transacao of transacoes) {
            if (transacao.node.initiationVia.paymentRequest === pedidoPagamento) {
                return transacao.node.settlementVia.preImage !== null;
            }
        }
        return false;
    } catch (erro) {
        console.error("Erro na conexão com a Blink API:", erro.response ? erro.response.data : erro.message);
        return false;
    }
}

// =====================
// Função para verificar operações pendentes (depósitos, retiradas, jogos) depois de reinicio de bot
// =====================
let aVerificarOperacoes = false;
async function verificarOperacoesPendentes() {
    console.log("🔍 Verificando jogos, depósitos e resgates pendentes...");
    let depositos = carregarDepositos();
    let resgates = carregarResgates();
    let dados = carregarDadosFF();
    let stats = carregarLucro();
    let codigosRef = carregarCodigosRef();
    const agora = Date.now();

    // Depósitos pendentes
    for (let userId in depositos) {
        let deposito = depositos[userId];
        let pagamentoConfirmado = await verificarEstadoPagamento(deposito.pedidoPagamento);
        if (pagamentoConfirmado && deposito.estado === "pendente") {
            deposito.estado = "concluido";
            dados[userId] = dados[userId] || { dinheiro: 0, vitorias: 0, derrotas: 0 };
            dados[userId].dinheiro += deposito.valorDeposito;
            const comissao = Math.ceil(deposito.valorDeposito * taxaComissao);
            stats.dinheiroFFserver += deposito.valorDeposito - comissao;

            // Verificar se o utilizador que depositou foi referenciado
            let referenciador = obterReferenciador(userId);
            if (referenciador) {
                // Calcular comissão de 1% (arredondado para baixo)
                const comissaoRef = Math.floor(deposito.valorDeposito * 0.01);
                dados[referenciador] = dados[referenciador] || { dinheiro: 0, vitorias: 0, derrotas: 0 };
                dados[referenciador].dinheiro += comissaoRef;

                // Atualizar a entrada do código de referência com o valor da comissão ganha
                const codigoUsado = Object.keys(codigosRef).find(codigo => codigosRef[codigo].referidos.includes(userId));
                if (!codigosRef[codigoUsado].ganho) {
                    codigosRef[codigoUsado].ganho = 0;
                }
                codigosRef[codigoUsado].ganho += comissaoRef;
                stats.lucro -= comissaoRef;
                guardarCodigosRef(codigosRef);

                // Opcionalmente, notificar o referenciador
                try {
                    let utilizadorRef = await client.users.fetch(referenciador);
                    utilizadorRef.send(`Ganhou uma comissão de **${comissaoRef} sats** de um depósito referenciado!`);
                } catch (erro) {
                    console.error(`Erro ao enviar mensagem de comissão para o utilizador ${referenciador}:`, erro);
                }
            }

            guardarLucro(stats);
            deposito.confirmado = true;
            guardarDepositos(depositos);
            guardarDadosFF(dados);
            try {
                let utilizador = await client.users.fetch(userId);
                utilizador.send(`✅ Depósito completo! Novo saldo: **${dados[userId].dinheiro}** sats.`);
            } catch (erro) {
                console.error(`Erro ao enviar mensagem para o utilizador ${userId}:`, erro);
            }
            if (definicoes.canalDeposito) {
                try {
                    const canalDeposito = await client.channels.fetch(definicoes.canalDeposito);
                    if (canalDeposito && canalDeposito.isTextBased()) {
                        canalDeposito.send(`💰 <@${userId}> depositou **${deposito.valorDeposito} sats**!`);
                    }
                } catch (erro) {
                    console.error("Erro ao enviar mensagem no canal de depósitos:", erro);
                }
            }
        } else if (!pagamentoConfirmado) {
            if (deposito.tempoExpiracao && agora >= deposito.tempoExpiracao) {
                console.log(`❌ Fatura expirada para o utilizador ${userId}. Removendo da lista pendente.`);
                let utilizador = await client.users.fetch(userId);
                utilizador.send(`❌ A fatura expirou!`);
                delete depositos[userId];
                guardarDepositos(depositos);
            } else {
                console.log(`⏳ Depósito do utilizador ${userId} ainda está aguardando pagamento.`);
            }
        }
    }
}
    
// =====================
// Funções dos Comandos (Adaptadas para Slash Commands)
// =====================

// /registar {idff} {senha} {nome} {datanasc}
async function registarComando(interaction) {
    const idff = interaction.options.getString("idff");
    const senha = interaction.options.getString("senha");
    const nome = interaction.options.getString("nome");
    const datanasc = interaction.options.getString("datanasc");
    const paypalEmail = interaction.options.getString("paypal_email");
    
    let dados = carregarDadosFF();
    if (dados[interaction.user.id]) {
        return interaction.reply({ content: "❌ Já está registado.", ephemeral: true });
    }
    
    // 1) Data de nascimento espera "DD/MM/YYYY"
    const [dia, mes, ano] = datanasc.split('/');
    const birthDate = new Date(`${ano}-${mes}-${dia}`); // formato ISO
    if (isNaN(birthDate)) {
        return interaction.reply({ content: '❌ Formato de data inválido. Usa DD/MM/YYYY.', ephemeral: true });
    }

    // 2) Cálculo da idade
    const hoje = new Date();
    let idade = hoje.getFullYear() - birthDate.getFullYear();
    const mesDiff = hoje.getMonth() - birthDate.getMonth();
    const diaDiff = hoje.getDate() - birthDate.getDate();
    // se ainda não fez aniversário este ano, subtrai 1
    if (mesDiff < 0 || (mesDiff === 0 && diaDiff < 0)) {
       idade--;
    }
    
    dados[interaction.user.id] = {
        idff,
        senha,
        nome,
        idade,
        paypalEmail: paypalEmail || null,  // armazena o e-mail (ou null)
        datanasc: birthDate.getTime(),
        dinheiro: 0,
        ganhosdetarefas: 0,
        vitorias: 0,
        derrotas: 0
    };  
    
    guardarDadosFF(dados);
    interaction.reply(`✅ Registado: **${nome}**\nIdade **${idade}** anos\nID-FF **${idff}**`);
  
    const guildId = "1322005942392459436";              // string do ID
    const guild   = client.guilds.cache.get(guildId);   // busca a Guild no cache

    if (!guild) { 
      return interaction.reply({ content: "❌ Não consegui encontrar o servidor para dar os cargos.\nContacte o suporte!",ephemeral: true });
    }

    const guildMember = await guild.members.fetch(interaction.user.id);
    const idCargoOk  = definicoes.idCargoRegistrado;
    const idCargoRem = definicoes.idCargoNaoRegistrado;

    if (idCargoOk)  await guildMember.roles.add(idCargoOk,  "Registro concluído");
    if (idCargoRem) await guildMember.roles.remove(idCargoRem, "Registro concluído");
}

// /login {idff} {senha}
async function loginComando(interaction) {
    const idff = interaction.options.getString("idff");
    const senha = interaction.options.getString("senha");
    let dados = carregarDadosFF();
    // Procura perfil com esse idff+senha
    let entrada = Object.entries(dados).find(([discId, perfil]) => perfil.idff === idff && perfil.senha === senha);
    if (!entrada) return interaction.reply({ content: "❌ Credenciais inválidas.", ephemeral: true });
    const [velhoDiscordId, perfil] = entrada;
    delete dados[velhoDiscordId];
    dados[interaction.user.id] = perfil;
    guardarDadosFF(dados);
    interaction.reply("✅ Login bem-sucedido, dados migrados para esta conta.");
}

// Comando: /mudarperfil {campo} {novo_valor}
async function mudarPerfilComando(interaction) {
  const campo = interaction.options.getString("campo");
  const novoValor = interaction.options.getString("novo_valor");
  const dados = carregarDadosFF();
  const perfil = dados[interaction.user.id];

  if (!perfil || !perfil.idff) {
    return interaction.reply({
      content: "❌ Ainda não estás registado. Usa `/registar` antes.",
      ephemeral: true
    });
  }

  // Altera o campo apropriado
  switch (campo) {
    case "idff":
      perfil.idff = novoValor;
      break;
    case "paypal":
      perfil.paypalEmail = novoValor;
      break;
    case "senha":
      perfil.senha = novoValor;
      break;
    default:
      // nunca chega aqui, pois choices já restrigem
      return interaction.reply({
        content: "❌ Campo inválido.",
        ephemeral: true
      });
  }

  guardarDadosFF(dados);
  return interaction.reply({
    content: `✅ O seu perfil foi atualizado: **${campo}** agora é **${novoValor}**`
  });
}


// Comando: /meuperfil
async function meuperfilComando(interaction) {
  const userId = interaction.user.id;
  const dados = carregarDadosFF();
  const perfil = dados[userId];

  if (!perfil || !perfil.idff) {
    return interaction.reply({content: "❌ Ainda não estás registado. Usa `/registar` para te registares.",ephemeral: true});
  }

  
  const embed = {
    color: 0x00AEFF,
    title: `📄 Perfil de <@${userId}>`,
    thumbnail: {
      url: interaction.user.displayAvatarURL()
    },
    fields: [
      { name: "🆔 ID FF", value: perfil.idff || "Não definido", inline: true },
      { name: "👤 Nome", value: perfil.nome || "Não definido", inline: true },
      { name: "🎂 Idade", value: perfil.idade?.toString() || "Não definida", inline: true },
      { name: "💳 PayPal Email",value : perfil.paypalEmail || "Não definido", inline: true},
      { name: "💸 Dinheiro", value: `${perfil.dinheiro || 0} sats`, inline: true },
      { name: "🤑 Ganhos de Tarefas", value: `${perfil.ganhosdetarefas || 0} sats`, inline: true },
      { name: "🏆 Vitórias", value: (perfil.vitorias || 0).toString(), inline: true },
      { name: "💀 Derrotas", value: (perfil.derrotas || 0).toString(), inline: true }
    ],
    timestamp: new Date(),
    footer: {
      text: "Perfil do usuário"
    }
  };

  
  const embed1 = {
    color: 0x00AEFF,
    title: `📄 Perfil de <@${userId}>`,
    thumbnail: {
      url: interaction.user.displayAvatarURL()
    },
    fields: [
      { name: "🆔 ID FF", value: perfil.idff || "Não definido", inline: true },
      { name: "👤 Nome", value: perfil.nome || "Não definido", inline: true },
      { name: "🎂 Idade", value: perfil.idade?.toString() || "Não definida", inline: true },
      { name: "💸 Dinheiro", value: `${perfil.dinheiro || 0} sats`, inline: true },
      { name: "🏆 Vitórias", value: (perfil.vitorias || 0).toString(), inline: true },
      { name: "💀 Derrotas", value: (perfil.derrotas || 0).toString(), inline: true }
    ],
    timestamp: new Date(),
    footer: {
      text: "Perfil do usuário"
    }
  };
  
  if (interaction.guild) {
  await interaction.reply({ embeds: [embed1]});
  } else {
    await interaction.reply({ embeds: [embed]});
  }
}


// Comando: /depositar
// Só pode ser usado em DM.
async function depositarComando(interaction, valor) {
  
  const dados = carregarDadosFF();
  const entry = dados[interaction.user.id];
  if (!entry || !entry.idff) {
    return interaction.reply({content: "❌ Tens de te registar antes de usar este comando. Usa `/registar` para te registares.", ephemeral: true});
  }
  
    if (valor < 10) {
        return interaction.reply({ content: "Valor de depósito inválido. Depósito mínimo: 10 sats.", ephemeral: true });
    }
    let depositos = carregarDepositos();
    const userId = interaction.user.id;
    if (depositos[userId]) {
        return interaction.reply({ content: "❌ Já tem um depósito pendente. Por favor, aguarde.", ephemeral: true });
    }
    const fatura = await criarFatura(valor);
    if (!fatura) {
        return interaction.reply({ content: "❌ Falha ao criar fatura para depósito. Por favor, tente novamente mais tarde.", ephemeral: true });
    }
    const tempoCriacao = Date.now();
    const minutosExpiracao = 2;
    const tempoExpiracao = tempoCriacao + minutosExpiracao * 60 * 1000;
    depositos[userId] = {
        valorDeposito: valor,
        pedidoPagamento: fatura.paymentRequest,
        estado: "pendente",
        tempoCriacao,
        tempoExpiracao,
    };
    guardarDepositos(depositos);
    await interaction.reply({ content: `💰 Para depositar **${valor} sats**, pague a fatura abaixo:` });
    await interaction.followUp({ content: `${fatura.paymentRequest}` });

    // Verifica o pagamento a cada 5 segundos
    const intervaloVerificacao = setInterval(async () => {
        let depositosAtuais = carregarDepositos();
        if (depositosAtuais[userId] && depositosAtuais[userId].estado === "pendente") {
            let pagamentoConfirmado = await verificarEstadoPagamento(depositosAtuais[userId].pedidoPagamento);
            if (pagamentoConfirmado) {
                clearInterval(intervaloVerificacao);
                verificarOperacoesPendentes(); // Reavaliar depósitos pendentes
            }
        } else {
            clearInterval(intervaloVerificacao);
        }
    }, 5000);
}

// Comando: /ganhar
async function ganharComando(interaction) {
  const userId = interaction.user.id;

  // MyLead
  const myLeadLink = `https://reward-me.eu/032b7c8a-56cd-11f0-86cf-c2a106037d45?player_id=${userId}`;

  // TimeWall
  const timeWallLink = `https://timewall.io/users/login?oid=11c905fcbd5a020b&uid=discord_${userId}&tab=tasks`;

  const embed = {
    title: "🎁 Ganhe Sats com Ofertas",
    description:
      `Clique em uma das plataformas abaixo para completar tarefas e ganhar recompensas automáticas no Discord:\n\n` +
      `🧩 **[MyLead Offerwall](<${myLeadLink}>)**\n\n` +
      `🎯 **[TimeWall Ofertas](<${timeWallLink}>)**`,
    color: 0x00AEFF,
    footer: {
      text: "Após completar as tarefas, aguarde alguns minutos para o saldo ser creditado.",
    },
  };

  await interaction.reply({ embeds: [embed] });
}


// Comando: /saldo
// Pode ser usado em DM ou em servidor.
async function saldoComando(interaction) {
  
  const allData = carregarDadosFF();
  const dados = allData[interaction.user.id];
  
  if (!dados || !dados.idff) {
    return interaction.reply({content: "❌ Tens de te registar antes de usar este comando. Usa `/registar` para te registares.", ephemeral: true});
  }

  const mensagem = `Saldo: **${dados.dinheiro} sats**`;
  if (interaction.guild) {
    interaction.reply(mensagem);
  } else {
    interaction.reply(mensagem);
  }
}


// ========== Comando: /meurefcode ==========
async function meurefcodeComando(interaction) {
  
  const dados = carregarDadosFF();
  const entry = dados[interaction.user.id];
  if (!entry || !entry.idff) {
    return interaction.reply({content: "❌ Tens de te registar antes de usar este comando. Usa `/registar` para te registares.", ephemeral: true});
  }
  
    const userId = interaction.user.id;
    const blacklist = carregarBlacklistRef();
    if (blacklist.includes(userId)) {
        return interaction.reply({ content: "Está banido de ter um código de referência.", ephemeral: true });
    }
    let codigosRef = carregarCodigosRef();
    // Verificar se já existe um código com o utilizador como proprietário
    let codigoUtilizador = Object.keys(codigosRef).find(codigo => codigosRef[codigo].proprietario === userId);
    if (!codigoUtilizador) {
        // Se não existir, criar um novo
        codigoUtilizador = gerarCodigoRefAleatorio();
        codigosRef[codigoUtilizador] = { proprietario: userId, referidos: [], ganho: 0 };
        guardarCodigosRef(codigosRef);
        await interaction.reply(`O seu código de referência é **${codigoUtilizador}**. Ganhará 1% de todos os depósitos dos amigos que convidar!`);
    } else {
        await interaction.reply(`O seu código de referência é **${codigoUtilizador}**.`);
    }
}

// ========== Comando: /usarrefcode ==========
async function usarrefcodeComando(interaction) {
  
  const dados = carregarDadosFF();
  const entry = dados[interaction.user.id];
  if (!entry || !entry.idff) {
    return interaction.reply({content: "❌ Tens de te registar antes de usar este comando. Usa `/registar` para te registares.", ephemeral: true});
  }

  
    // Obter o código de referência e o ID do utilizador
    const codigo = interaction.options.getString("codigo").toUpperCase();
    const userId = interaction.user.id;
    let codigosRef = carregarCodigosRef();

    // Verificar se o código de referência existe
    if (!codigosRef[codigo]) {
        return interaction.reply({ content: "Código de referência inválido.", ephemeral: true });
    }

    // Verificar se o utilizador já usou o código de referência
    if (codigosRef[codigo].referidos.includes(userId)) {
        return interaction.reply({ content: "Já usou este código de referência.", ephemeral: true });
    }

    // Verificar se o utilizador está a tentar usar o seu próprio código de referência
    if (codigosRef[codigo].proprietario === userId) {
        return interaction.reply({ content: 'Não pode usar o seu próprio código de referência.', ephemeral: true });
    }

    // Verificar se o utilizador já usou outro código de referência
    for (const ref in codigosRef) {
        if (codigosRef[ref].referidos.includes(userId)) {
            return interaction.reply({ content: "Já usou um código de referência. Não pode usar outro.", ephemeral: true });
        }
    }

    // Adicionar o utilizador à lista de referidos para o código de referência fornecido
    codigosRef[codigo].referidos.push(userId);
    guardarCodigosRef(codigosRef);

    // Enviar mensagem de sucesso
    await interaction.reply(`Foi referenciado com sucesso por <@${codigosRef[codigo].proprietario}>!`);
}

// ========== Comando: /banrefcode ==========
async function banrefcodeComando(interaction) {
    // Apenas administradores podem banir códigos de referência
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: "❌ Não tem permissão para usar este comando.", ephemeral: true });
    }
    // Este comando deve receber um utilizador como parâmetro
    const utilizadorAlvo = interaction.options.getUser("utilizador");
    const idAlvo = utilizadorAlvo.id;

    let codigosRef = carregarCodigosRef();
    // Encontrar o código de referência para o utilizador a ser banido
    let codigoUtilizador = Object.keys(codigosRef).find(codigo => codigosRef[codigo].proprietario === idAlvo);
    if (!codigoUtilizador) {
        return interaction.reply({ content: "Este utilizador não tem um código de referência.", ephemeral: true });
    }
    // Remover o código do ficheiro de códigos de referência
    delete codigosRef[codigoUtilizador];
    guardarCodigosRef(codigosRef);

    // Adicionar o utilizador à blacklist
    let blacklist = carregarBlacklistRef();
    if (!blacklist.includes(idAlvo)) {
        blacklist.push(idAlvo);
        guardarBlacklistRef(blacklist);
    }

    await interaction.reply(`O código de referência para o utilizador <@${idAlvo}> foi banido. Ele não poderá mais receber 1% de depósitos referenciados.`);
}

// Comando: /money (Ajustar saldo de utilizador - Admin)
async function moneyComando(interaction, utilizadorAlvo, valor) {
    if (!interaction.guild) {
        return interaction.reply({ content: "❌ Este comando só pode ser usado num servidor.", ephemeral: true });
    }
    if (interaction.user.id !== interaction.guild.ownerId && (!definicoes.idCargoAdmin || !interaction.member.roles.cache.has(definicoes.idCargoAdmin))) {
        return interaction.reply({ content: "❌ Não tem permissão para usar este comando.", ephemeral: true });
    }

    let stats = carregarLucro();
    let dados = carregarDadosFF();
    const userId = utilizadorAlvo.id;
    if (!dados[userId]) {
        dados[userId] = { dinheiro: 0, vitorias: 0, derrotas: 0 };
        guardarDadosFF(dados);
    }

    dados[userId].dinheiro += valor;
    stats.lucro -= valor;
    guardarLucro(stats);
    guardarDadosFF(dados);
    interaction.reply({ content: `O saldo de <@${userId}> foi atualizado para **${dados[userId].dinheiro} sats**. ( **${valor} sats** )` });
}

// Comando: /adsc
async function adscComando(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: "❌ Este comando só pode ser usado num servidor.", ephemeral: true });
    }
    if (interaction.user.id !== interaction.guild.ownerId && (!definicoes.idCargoAdmin || !interaction.member.roles.cache.has(definicoes.idCargoAdmin))) {
        return interaction.reply({ content: "❌ Não tem permissão para usar este comando.", ephemeral: true });
    }
    definicoes.canalAds = interaction.channel.id;
    guardarDefinicoes();
    interaction.reply({ content: `✅ Canal de anúncios definido para: <#${interaction.channel.id}>` });
}

// Comando: /oftc
async function oftcComando(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: "❌ Este comando só pode ser usado num servidor.", ephemeral: true });
    }
    if (interaction.user.id !== interaction.guild.ownerId && (!definicoes.idCargoAdmin || !interaction.member.roles.cache.has(definicoes.idCargoAdmin))) {
        return interaction.reply({ content: "❌ Não tem permissão para usar este comando.", ephemeral: true });
    }
    definicoes.canalOfertas = interaction.channel.id;
    guardarDefinicoes();
    interaction.reply({ content: `✅ Canal de recompensas de ofertas recebidas definido para: <#${interaction.channel.id}>` });
}

// Comando: /dptc
async function dptcComando(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: "❌ Este comando só pode ser usado num servidor.", ephemeral: true });
    }
    if (interaction.user.id !== interaction.guild.ownerId && (!definicoes.idCargoAdmin || !interaction.member.roles.cache.has(definicoes.idCargoAdmin))) {
        return interaction.reply({ content: "❌ Não tem permissão para usar este comando.", ephemeral: true });
    }
    definicoes.canalDeposito = interaction.channel.id;
    guardarDefinicoes();
    interaction.reply({ content: `✅ Canal de depósitos definido para: <#${interaction.channel.id}>` });
}

// Comando: /wtdc
async function wtdcComando(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: "❌ Este comando só pode ser usado num servidor.", ephemeral: true });
    }
    if (interaction.user.id !== interaction.guild.ownerId && (!definicoes.idCargoAdmin || !interaction.member.roles.cache.has(definicoes.idCargoAdmin))) {
        return interaction.reply({ content: "❌ Não tem permissão para usar este comando.", ephemeral: true });
    }
    definicoes.canalResgates = interaction.channel.id;
    guardarDefinicoes();
    interaction.reply({ content: `✅ Canal de levantamentos definido para: <#${interaction.channel.id}>` });
}

// Comando: /dfcadm
async function dfcadmComando(interaction, cargo) {
    if (!interaction.guild) {
        return interaction.reply({ content: "❌ Este comando só pode ser usado num servidor.", ephemeral: true });
    }
    if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: "❌ Não tem permissão para usar este comando.", ephemeral: true });
    }
    definicoes.idCargoAdmin = cargo.id;
    guardarDefinicoes();

    interaction.reply({ content: `✅ O cargo <@&${cargo.id}> agora está autorizado a usar comandos de administrador.` });
}

// Comando: /rifasc
async function rifascComando(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: "❌ Este comando só pode ser usado num servidor.", ephemeral: true });
    }
    // Apenas o dono do servidor pode configurar o canal
    if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: "❌ Apenas o dono do servidor pode usar este comando.", ephemeral: true });
    }
    definicoes.canalRifas = interaction.channel.id;
    guardarDefinicoes();
    return interaction.reply({ content: `Canal de Rifas definido para <#${interaction.channel.id}>.`, ephemeral: true });
}

// Comando: /trifasc
async function trifascComando(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: "❌ Este comando só pode ser usado num servidor.", ephemeral: true });
    }
    // Apenas o dono do servidor pode configurar o canal
    if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: "❌ Apenas o dono do servidor pode usar este comando.", ephemeral: true });
    }
    definicoes.canalTransacoesRifa = interaction.channel.id;
    guardarDefinicoes();
    return interaction.reply({ content: `Canal de Transações de Rifas definido para <#${interaction.channel.id}>.`, ephemeral: true });
}

// Comando: /crifa
async function crifaComando(interaction, valor, numeromaxbilhetes) {
    if (valor <= 0 || numeromaxbilhetes <= 0) {
        return interaction.reply({ content: "O valor do bilhete e o número máximo de bilhetes devem ser maiores que zero.", ephemeral: true });
    }
    if (!interaction.guild) {
        return interaction.reply({ content: "Este comando só pode ser usado num servidor.", ephemeral: true });
    }
    if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: "Apenas o dono do servidor pode usar este comando.", ephemeral: true });
    }

    const idRifa = obterProximoIdRifa();
    const totalArrecadado = valor * numeromaxbilhetes;
    const premio = Math.floor(totalArrecadado * 0.85);
    const dadosRifa = {
        premio: premio,
        valor: valor,            // Valor por bilhete (em sats)
        numeromaxbilhetes: numeromaxbilhetes,  // Número máximo de bilhetes
        totalBilhetesVendidos: 0,     // Total de bilhetes vendidos
        bilhetesDisponiveis: Array.from({ length: numeromaxbilhetes }, (_, i) => i + 1), // Bilhetes disponíveis para compra
        participantes: {}        // Lista de participantes (usuários e seus bilhetes)
    };

    const ficheiroRifa = path.join(__dirname, `rifa(${idRifa}).json`);
    fs.writeFileSync(ficheiroRifa, JSON.stringify(dadosRifa, null, 2));

    // Envia uma mensagem ao canal da rifa, se estiver configurado
    if (definicoes.canalRifas) {
        try {
            const canal = await client.channels.fetch(definicoes.canalRifas);
            if (canal && canal.isTextBased()) {
                canal.send(`--------------------------\n@everyone\nRifa ID: ${idRifa}\nPrémio: **${premio} sats**\nValor/Bilhete: ${valor} sats\nTotal de Bilhetes: ${numeromaxbilhetes}`);
            }
        } catch (error) {
            console.error("Erro ao enviar mensagem de criação de rifa:", error);
        }
    }
    return interaction.reply({ content: `Rifa criada com ID ${idRifa}!` });
}

// Comando: /comprarbilheterifa
async function comprarBilheteRifaComando(interaction, idRifa, quantidade) {
  
  const dados = carregarDadosFF();
  const entry = dados[interaction.user.id];
  if (!entry || !entry.idff) {
    return interaction.reply({content: "❌ Tens de te registar antes de usar este comando. Usa `/registar` para te registares.", ephemeral: true});
  }
  
    let stats = carregarLucro();
    const ficheiroRifa = path.join(__dirname, `rifa(${idRifa}).json`);

    if (!fs.existsSync(ficheiroRifa)) {
        return interaction.reply({ content: "Rifa não encontrada.", ephemeral: true });
    }

    // Carrega os dados da rifa
    let dadosRifa = JSON.parse(fs.readFileSync(ficheiroRifa, "utf8"));

    // Carrega os dados do usuário (saldo, etc.)
    let dadosUtilizador = carregarDadosFF();
    if (!dadosUtilizador[interaction.user.id]) {
        dadosUtilizador[interaction.user.id] = { dinheiro: 0, vitorias: 0, derrotas: 0 };
    }

    // Calcula o custo total dos bilhetes e verifica se o usuário tem fundos suficientes
    const custoTotal = dadosRifa.valor * quantidade;
    if (dadosUtilizador[interaction.user.id].dinheiro < custoTotal) {
        return interaction.reply({ content: "Não tem fundos suficientes para comprar tantos bilhetes.", ephemeral: true });
    }

    // Verifica quantos bilhetes ainda estão disponíveis
    const quantidadeDisponivel = dadosRifa.bilhetesDisponiveis.length;
    if (quantidade > quantidadeDisponivel) {
        return interaction.reply({ content: `Não há bilhetes suficientes disponíveis.\nBilhetes Disponíveis: **${quantidadeDisponivel}**`, ephemeral: true });
    }

    // Selecione aleatoriamente 'quantidade' bilhetes dentre os disponíveis
    let bilhetesComprados = [];
    for (let i = 0; i < quantidade; i++) {
        const indiceAleatorio = Math.floor(Math.random() * dadosRifa.bilhetesDisponiveis.length);
        // Remove o bilhete sorteado (garantindo que não seja escolhido novamente)
        let numeroBilhete = dadosRifa.bilhetesDisponiveis.splice(indiceAleatorio, 1)[0];
        bilhetesComprados.push(numeroBilhete);
    }

    // Atualiza o total de bilhetes vendidos (pode ser definido como: numeromaxbilhetes - bilhetesDisponiveis.length)
    dadosRifa.totalBilhetesVendidos = dadosRifa.numeromaxbilhetes - dadosRifa.bilhetesDisponiveis.length;

    // Atualiza ou cria a entrada do usuário, armazenando os números comprados
    if (dadosRifa.participantes[interaction.user.id]) {
        // Caso o usuário já possua bilhetes: concatena os números novos
        dadosRifa.participantes[interaction.user.id].bilhetes = dadosRifa.participantes[interaction.user.id].bilhetes.concat(bilhetesComprados);
    } else {
        dadosRifa.participantes[interaction.user.id] = { bilhetes: bilhetesComprados };
    }

    // Atualiza a "chance" para o usuário (opcional; chance em % = (total de bilhetes do usuário / numeromaxbilhetes) * 100)
    dadosRifa.participantes[interaction.user.id].chance = (dadosRifa.participantes[interaction.user.id].bilhetes.length / dadosRifa.numeromaxbilhetes) * 100;

    // Desconta o valor do usuário e atualiza os lucros do servee
    dadosUtilizador[interaction.user.id].dinheiro -= custoTotal;
    guardarDadosFF(dadosUtilizador);
    stats.lucro += custoTotal;
    guardarLucro(stats);

    // Salva os dados atualizados da rifa
    fs.writeFileSync(ficheiroRifa, JSON.stringify(dadosRifa, null, 2));

    // Envia a confirmação ao usuário
    await interaction.reply({ content: `<@${interaction.user.id}>, compraste os bilhetes n°: ${bilhetesComprados.join(", ")}.\nBoa Sorte!` });

    if (definicoes.canalTransacoesRifa) {
        try {
            const canal = await client.channels.fetch(definicoes.canalTransacoesRifa);
            if (canal && canal.isTextBased()) {
                canal.send(`--------------------------\n<@${interaction.user.id}>\nRifa ID: ${idRifa}\nComprou ${quantidade} bilhete(s).`);
            }
        } catch (error) {
            console.error("Erro ao enviar mensagem de transação de compra de rifa:", error);
        }
    }

    // Se todos os bilhetes foram vendidos, sorteia o vencedor
    if (dadosRifa.totalBilhetesVendidos === dadosRifa.numeromaxbilhetes) {
        // Sorteia um número vencedor entre 1 e numeromaxbilhetes
        const numeroVencedor = Math.floor(Math.random() * dadosRifa.numeromaxbilhetes) + 1;

        let idVencedor = null;
        // Itera por todos os participantes para encontrar o usuário que possui o numeroVencedor
        for (const [userId, participante] of Object.entries(dadosRifa.participantes)) {
            if (participante.bilhetes && participante.bilhetes.includes(numeroVencedor)) {
                idVencedor = userId;
                break;
            }
        }

        if (idVencedor) {
            // Calcula o prémio (por exemplo, 85% do total arrecadado)
            const totalArrecadado = dadosRifa.valor * dadosRifa.numeromaxbilhetes;
            const premio = Math.floor(totalArrecadado * 0.85);

            // Atualiza o saldo do usuário vencedor
            let data = carregarDadosFF();
            if (!data[idVencedor]) {
                data[idVencedor] = { dinheiro: 0, vitorias: 0, derrotas: 0 };
            }
            data[idVencedor].dinheiro += premio;
            guardarDadosFF(data);

            stats.lucro -= premio;
            guardarLucro(stats);

            // Anuncia o vencedor no canal de rifa (se configurado)
            if (definicoes.canalRifas) {
                try {
                    const canal = await client.channels.fetch(definicoes.canalRifas);
                    if (canal && canal.isTextBased()) {
                        const bilhetesVencedor = dadosRifa.participantes[idVencedor].bilhetes.join(", ");
                        canal.send(
                            `--------------------------\n` +
                            `Rifa ID: ${idRifa}\n` +
                            `Número Vencedor: ${numeroVencedor}\n` +
                            `Vencedor: <@${idVencedor}>\n` +
                            `Bilhetes Comprados: [${bilhetesVencedor}]\n` +
                            `Prémio: ${premio} sats!\n\n` +
                            `Obrigado a todos que participaram! Boa sorte na próxima rifa!`);
                    }
                } catch (err) {
                    console.error("Erro ao enviar mensagem de vencedor da rifa:", err);
                }
            }

            // Remove o arquivo da rifa, pois ela se encerrou
            fs.unlinkSync(ficheiroRifa);

            return interaction.followUp({ content: `<@${interaction.user.id}>, todos os bilhetes foram vendidos!\nNúmero Vencedor: ${numeroVencedor}\nVencedor: <@${idVencedor}> ganhou ${premio} sats!` });
        } else {
            // Caso não encontre um vencedor (o que não deve ocorrer se a compra foi bem feita)
            return interaction.followUp("Rifa terminou mas nenhum vencedor foi determinado. Por favor, contacte um administrador.");
        }
    } else {
        // Se a rifa ainda não foi finalizada, informa a chance atual do usuário
        return interaction.followUp({ content: `<@${interaction.user.id}>, comprou ${dadosRifa.participantes[interaction.user.id].bilhetes.length} bilhete(s) para a rifa ${idRifa}. Sua chance atual de ganhar é ${dadosRifa.participantes[interaction.user.id].chance.toFixed(2)}%.` });
    }
}

// Comando: /drifa
async function drifaComando(interaction, idRifa) {
    if (!interaction.guild) {
        return interaction.reply({ content: "Este comando só pode ser usado num servidor.", ephemeral: true });
    }
    if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: "Apenas o dono do servidor pode usar este comando.", ephemeral: true });
    }
    const ficheiroRifa = path.join(__dirname, `rifa(${idRifa}).json`);
    if (!fs.existsSync(ficheiroRifa)) {
        return interaction.reply({ content: "Rifa não encontrada.", ephemeral: true });
    }
    fs.unlinkSync(ficheiroRifa);
    return interaction.reply({ content: `Rifa ${idRifa} foi eliminada.`, ephemeral: true });
}

// Comando: /addloja
async function addlojaComando(interaction, nomeItem, preco, quantidade) {
    if (!interaction.guild) {
        return interaction.reply({ content: "❌ Este comando só pode ser usado num servidor.", ephemeral: true });
    }
    if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: "❌ Apenas o dono do servidor pode usar este comando.", ephemeral: true });
    }

    if (preco <= 0 || quantidade <= 0) {
        return interaction.reply({ content: "❌ O preço e a quantidade devem ser maiores que zero.", ephemeral: true });
    }

    const dadosLoja = carregarLoja();
    const idItem = obterProximoIdItemLoja();

    dadosLoja[idItem] = {
        nome: nomeItem,
        preco_usd: preco,
        quantidade: quantidade,
    };

    guardarLoja(dadosLoja);
    interaction.reply(`✅ Item **${nomeItem}** adicionado à loja com ID **${idItem}**, preço **${preco} $**, quantidade **${quantidade}**`);
}


// /addstock {id do item da loja} {infinito/quantidade específica}
async function addstockComando(interaction, idItem, quantStr) {
  // só dona(o) do servidor pode usar
  if (!interaction.guild || interaction.user.id !== interaction.guild.ownerId) {
    return interaction.reply({ content: "❌ Apenas o dono do servidor pode usar este comando.", ephemeral: true });
  }

  const dadosLoja = carregarLoja();
  if (!dadosLoja[idItem]) {
    return interaction.reply({ content: `❌ Item com ID **${idItem}** não encontrado.`, ephemeral: true });
  }

  // interpretar quantidade
  let novaQtd;
  if (quantStr.toLowerCase() === "infinito") {
    novaQtd = null;  // null = stock ilimitado
  } else {
    const q = parseInt(quantStr, 10);
    if (isNaN(q) || q < 0) {
      return interaction.reply({ content: "❌ Quantidade inválida. Usa um número ≥ 0 ou “infinito”.", ephemeral: true });
    }
    novaQtd = q;
  }

  dadosLoja[idItem].quantidade = novaQtd;
  guardarLoja(dadosLoja);

  const desc = novaQtd === null
    ? "📦 Stock definido como **ilimitado**"
    : `📦 Stock definido para **${novaQtd}** unidades`;
  return interaction.reply({ content: `✅ Item **${dadosLoja[idItem].nome}** (ID ${idItem}): ${desc}.` });
}


// Comando: /dloja
async function dlojaComando(interaction, idItem) {
    if (!interaction.guild) {
        return interaction.reply({ content: "❌ Este comando só pode ser usado num servidor.", ephemeral: true });
    }
    if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: "❌ Apenas o dono do servidor pode usar este comando.", ephemeral: true });
    }

    const dadosLoja = carregarLoja();

    if (!dadosLoja[idItem]) {
        return interaction.reply({ content: `❌ Item com ID **${idItem}** não encontrado na loja.`, ephemeral: true });
    }

    const nomeRemovido = dadosLoja[idItem].nome;
    delete dadosLoja[idItem];
    guardarLoja(dadosLoja);

    interaction.reply(`✅ Item **${nomeRemovido}** (ID **${idItem}**) removido da loja.`);
}


// Comando: /loja
async function lojaComando(interaction) {
  
  const dados = carregarDadosFF();
  const entry = dados[interaction.user.id];
  if (!entry || !entry.idff) {
    return interaction.reply({content: "❌ Tens de te registar antes de usar este comando. Usa `/registar` para te registares.", ephemeral: true});
  }

    const dadosLoja = carregarLoja();
    const itens = Object.entries(dadosLoja);

    if (itens.length === 0) {
        return interaction.reply("❌ A loja está vazia.");
    }

    // 1) Busca a cotação USD→BTC (satoshis por 1 USD)
    const res = await axios.get("https://api.mempool.space/api/v1/prices");
    const satsPerUsd = 100_000_000 / res.data.USD;

    // 2) Mapeia para incluir precoSats em cada item
    const itensComSats = itens.map(([id, item]) => {
        const precoSats = Math.round(item.preco_usd * satsPerUsd);
        return [id, { ...item, precoSats }];
    });

    // 3) Ordena pelo preço em sats
    itensComSats.sort(([, a], [, b]) => a.precoSats - b.precoSats);

    // 4) Monta a lista de saída
    let lista = "🛍️ **Itens da Loja:**\n";
    for (const [id, item] of itensComSats) {
        lista +=
        `**------------------------**\n`+
        `**ID:** ${id}\n`+
        `**Nome:** ${item.nome}\n`+
        `**Preço:** ${item.precoSats} sats\n`+
        `**Disponível:** ${item.quantidade === null ? '∞' : item.quantidade}\n` +
        `**------------------------**\n`;
    }

    // 5) Envia (ephemeral em guilda)
    if (interaction.guild) {
        return interaction.reply({ content: lista, ephemeral: true });
    } else {
        return interaction.reply({ content: lista });
    }
}
    
    
// Comando: /comprar
async function comprarComando(interaction, idItem, quantidade) {
  
  const dados = carregarDadosFF();
  const entry = dados[interaction.user.id];
  if (!entry || !entry.idff) {
    return interaction.reply({content: "❌ Tens de te registar antes de usar este comando. Usa `/registar` para te registares.", ephemeral: true});
  }

    if (quantidade <= 0) {
        return interaction.reply({ content: "❌ A quantidade deve ser maior que zero.", ephemeral: true });
    }
    
    const resgates = carregarResgates();
    const dadosLoja = carregarLoja();
    const userId = interaction.user.id;

    if (!dadosLoja[idItem]) {
        return interaction.reply({ content: `❌ Item com ID **${idItem}** não encontrado na loja.`, ephemeral: true });
    }

    const item = dadosLoja[idItem];

    if (item.quantidade !== null && item.quantidade < quantidade) {
      return interaction.reply({ content: `❌ Não há **${item.nome}** suficientes disponíveis na loja. Disponível: **${item.quantidade}**.`, ephemeral: true });
    }

    const precoSats = await usdToSats(item.preco_usd);
    const custoTotal = Math.round(precoSats * quantidade);

    if (dados[userId].dinheiro < custoTotal) {
        return interaction.reply({ content: "❌ Não tem moedas suficientes para comprar este item.", ephemeral: true });
    }

    // Atualizar o saldo do utilizador e a quantidade do item na loja
    dados[userId].dinheiro -= custoTotal;
    item.quantidade -= quantidade;
    guardarDadosFF(dados);
    guardarLoja;
  
    const paypalEmail = dados[userId].paypalEmail;
    const idff = dados[userId].idff
    
    // Carrega o último ID usado
    let lastId = carregarPurchaseCount();
    const nextId = lastId + 1;
    guardarPurchaseCount(nextId);
    const purchaseId = nextId.toString();
  
    resgates[purchaseId] = {
        id: purchaseId,
        userId: interaction.user.id,
        item: item.nome,
        quantidade,
        paypalEmail,      
        idff,
        status: "pendente",
        createdAt: new Date().toISOString()
    };
    guardarResgates(resgates);
    try {
        const ownerId = "810295459536830485";
        const ownerUser = await client.users.fetch(ownerId);
        await ownerUser.send(
            `🆔 Compra: **${purchaseId}**\n` +
            `🛒 **Nova compra pendente**\n` +
            `👤 Usuário: <@${interaction.user.id}>\n` +
            `🆔 ID-FF: ${idff}\n` +
            `📧 PayPal: ${paypalEmail}\n` +
            `📦 Item: **${item.nome}** (×${quantidade})\n`
        );
    } catch (err) {
        console.error("Erro ao notificar dono do servidor:", err);
    }   
    // Guardar os dados atualizados
    guardarDadosFF(dados);
    guardarLoja(dadosLoja);

    interaction.reply(`✅ Comprou **${quantidade} ${item.nome}(s)** por **${custoTotal} sats**.\nNovo saldo: **${dados[userId].dinheiro} sats**\nA sua compra poderá demorar até 24h para ser entregue na sua conta!`);
}

    
    // comando: /donecompra
    async function donecompraComando(interaction, compraId) {
        
        if (!interaction.guild) {
            return interaction.reply({ content: "❌ Este comando só pode ser usado num servidor.", ephemeral: true });
        }
        if (interaction.user.id !== interaction.guild.ownerId) {
            return interaction.reply({ content: "❌ Apenas o dono do servidor pode usar este comando.", ephemeral: true });
        }

        const resgates = carregarResgates();
        const compra = resgates[compraId];
        if (!compra) {
            return interaction.reply({ content: `❌ Compra com ID **${compraId}** não encontrada.`, ephemeral: true });
        }

        compra.status = "concluido";
        guardarResgates(resgates);

        await interaction.reply({ content: `✅ Compra **${compraId}** marcada como concluída.` });

        try {
            const usuario = await client.users.fetch(compra.userId);
            await usuario.send(`✅ Olá! Sua compra **${compraId}** de **${compra.quantidade}× ${compra.item}** foi concluída.`);
        } catch (err) {
            console.error(`Erro ao notificar usuário da compra ${compraId}:`, err);
        }
        
        if (definicoes.canalResgates) {
            try {
                const canal = await client.channels.fetch(definicoes.canalResgates);
                await canal.send(`🎉 <@${compra.userId}> comprou com sucesso **${compra.item}** (` +`${compra.quantidade}×) — ID: **${compraId}**`);
            } catch (err) {
                console.error(`Erro ao enviar mensagem de levantamento no canal:`, err);
            }
        }
    }

    // /dfclider {A|B|C} {cargo}
    async function dfcliderComando(interaction, equipa, cargo) {
      if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: "❌ Só o dono do servidor pode configurar líderes.", ephemeral: true });
      }
      definicoes.equipes[equipa].lider = cargo.id;
      guardarDefinicoes();
      interaction.reply(`✅ Cargo <@&${cargo.id}> definido como **líder** da equipa **${equipa}**.`);
    }

    // /dfcmembroseq {A|B|C} {cargo}
    async function dfcmembroseqComando(interaction, equipa, cargo) {
      if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: "❌ Só o dono do servidor pode configurar membros.", ephemeral: true });
      }
      definicoes.equipes[equipa].membro = cargo.id;
      guardarDefinicoes();
      interaction.reply(`✅ Cargo <@&${cargo.id}> definido como **membro** da equipa **${equipa}**.`);
    }

    // /cnvdeq {@user}
    async function convidarEquipeComando(interaction, alvoUser) {
      // descobrir em que equipa o invocador é líder
      const guildMember = interaction.member;
      const equipa = Object.entries(definicoes.equipes).find(([letra, cfg]) => cfg.lider === guildMember.roles.highest.id);
      if (!equipa) {
        return interaction.reply({ content: "❌ Só um líder de equipa pode usar este comando.", ephemeral: true });
      }
      const [letraEquipe] = equipa;
      const roleMembroId = definicoes.equipes[letraEquipe].membro;
      if (!roleMembroId) {
        return interaction.reply({ content: `❌ A equipa ${letraEquipe} ainda não tem cargo de membro definido.`, ephemeral: true });
      }
      // atribuir cargo
      const membro = interaction.guild.members.cache.get(alvoUser.id);
      await membro.roles.add(roleMembroId, `Convite pela equipa ${letraEquipe}`);
      guardarDefinicoes();
      
      // enviar mensagem de anúncio
      const chanId = definicoes.equipes[letraEquipe].adschannel;
      if (chanId) {const canalAnuncios = interaction.guild.channels.cache.get(chanId);
        if (canalAnuncios && canalAnuncios.isText()) {
          canalAnuncios.send(`🎉 Parabéns <@${alvoUser.id}>, és agora membro da **equipe ${letraEquipe}**!`);
        }
      }
      
      interaction.reply(`✅ <@${alvoUser.id}> foi convidado para a equipa **${letraEquipe}**.`);
    }

    // /removereq {@user} {motivo}
    async function removerEquipeComando(interaction, alvoUser, motivo) {
      // verificar se invocador é líder
      const guildMember = interaction.member;
      const equipa = Object.entries(definicoes.equipes).find(([letra, cfg]) => cfg.lider === guildMember.roles.highest.id);
      if (!equipa) {
        return interaction.reply({ content: "❌ Só um líder de equipa pode usar este comando.", ephemeral: true });
      }
      const [letraEquipe] = equipa;
      const roleMembroId = definicoes.equipes[letraEquipe].membro;
      if (!roleMembroId) {
        return interaction.reply({ content: `❌ A equipa ${letraEquipe} ainda não tem cargo de membro definido.`, ephemeral: true });
      }
      // remover cargo e kick
      const membro = interaction.guild.members.cache.get(alvoUser.id);
      if (!membro.roles.cache.has(roleMembroId)) {
        return interaction.reply({ content: "❌ Este utilizador não é membro da sua equipa.", ephemeral: true });
      }
      await membro.roles.remove(roleMembroId, `Removido pela equipa ${letraEquipe}: ${motivo}`);
      await membro.kick(`Removido da equipa ${letraEquipe}: ${motivo}`);
      guardarDefinicoes();
      
      // enviar mensagem de remoção no canal de anúncios
      const chanId = definicoes.equipes[letraEquipe].adschannel;
      if (chanId) {
        const canalAnuncios = interaction.guild.channels.cache.get(chanId);
        if (canalAnuncios && canalAnuncios.isText()) {
          canalAnuncios.send(
          `⚠️ O membro <@${alvoUser.id}> foi **removido** da equipe **${letraEquipe}**.\n` +
          `📝 Motivo: ${motivo}`
          );
        }
      }
      
      interaction.reply(`✅ <@${alvoUser.id}> removido da equipa **${letraEquipe}**. Motivo: ${motivo}`);
    }

    
   // /adseqc {A|B|C}
   async function adseqcComando(interaction, equipa, canal) {
     if (interaction.user.id !== interaction.guild.ownerId) {
       return interaction.reply({ content: "❌ Só o dono do servidor pode configurar canais de anúncio.", ephemeral: true });
     }
     definicoes.equipes[equipa].adschannel = canal.id;
     guardarDefinicoes();
     interaction.reply(`✅ Canal <#${canal.id}> definido como **anúncios** da equipa **${equipa}**.`);
   }


   // /donatec {canal}
   async function donatecComando(interaction, canal) {
     if (interaction.user.id !== interaction.guild.ownerId) {
       return interaction.reply({ content: "❌ Só o dono do servidor pode configurar o canal de doações.", ephemeral: true });
     }
     definicoes.donationChannel = canal.id;
     guardarDefinicoes();
     interaction.reply(`✅ Canal <#${canal.id}> definido para anúncios de doações.`);
   }

   // /doar {satoshis}
   async function doarComando(interaction, sats) {
     const userId = interaction.user.id;
     // Carrega todos os dados de utilizadores
     const dados = carregarDadosFF();
     const entry = dados[interaction.user.id];
     if (!entry || !entry.idff) {
       return interaction.reply({content: "❌ Tens de te registar antes de usar este comando. Usa `/registar` para te registares.", ephemeral: true});
     }

     const saldoAtual = dados[userId].dinheiro;
     // Verificar saldo suficiente
     if (saldoAtual < sats) {
       return interaction.reply({content: `❌ Saldo insuficiente. Tens apenas **${saldoAtual} sats**.`,ephemeral: true});
     }
     // Debitar do ficheiro de dados
     dados[userId].dinheiro = saldoAtual - sats;
     guardarDadosFF(dados);

     // Anunciar doação no canal configurado
     const chanId = definicoes.donationChannel;
     if (chanId) {
       const canalDoacoes = interaction.guild.channels.cache.get(chanId);
       if (canalDoacoes && canalDoacoes.isText()) {
         canalDoacoes.send(`🙏 <@${userId}> doou **${sats} sats**! Muito obrigado pela tua generosidade!`);
       }
     }
     
     // Confirmação ao doador (privado)
     return interaction.reply({content: `💸 Doaste **${sats} sats**! Obrigado!`,ephemeral: true});
   }


// Comando: /dfcaddrem {cargo_registrado} {cargo_nao_registrado}
async function dfcaddremComando(interaction, cargo_registrado, cargo_nao_registrado) {
  if (!interaction.guild) {
    return interaction.reply({ content: "❌ Este comando só pode ser usado num servidor.", ephemeral: true });
  }
  if (interaction.user.id !== interaction.guild.ownerId) {
    return interaction.reply({ content: "❌ Apenas o dono do servidor pode usar este comando.", ephemeral: true });
  }
  // Salva nos definititions
  definicoes.idCargoRegistrado = cargo_registrado.id;
  definicoes.idCargoNaoRegistrado = cargo_nao_registrado.id;
  guardarDefinicoes();
  interaction.reply({
    content: `✅ Cargo de registrado definido para <@&${cargo_registrado.id}> e cargo a remover definido para <@&${cargo_nao_registrado.id}>.`
  });
}


// =====================
// Funções de apoio
// =====================
    
// Funções de Aposta (A IMPLEMENTAR)
async function apostarComando(interaction) {
    // IMPLEMENTAR
    interaction.reply({ content: "Comando /apostar em construção!", ephemeral: true });
}
async function aceitarComando(interaction) {
    // IMPLEMENTAR
    interaction.reply({ content: "Comando /aceitar em construção!", ephemeral: true });
}
async function recusarComando(interaction) {
    // IMPLEMENTAR
    interaction.reply({ content: "Comando /recusar em construção!", ephemeral: true });
}
async function resultadodoapComando(interaction) {
    // IMPLEMENTAR
    interaction.reply({ content: "Comando /resultadodoap em construção!", ephemeral: true });
}
async function resultadoapadmComando(interaction) {
    // IMPLEMENTAR
    interaction.reply({ content: "Comando /resultadoapadm em construção!", ephemeral: true });
}
// =====================
// Registro dos Comandos de Barra (Slash Commands)
// =====================

const comandosData = [
    {
        name: "registar",
        description: "Registar no sistema FF",
        options: [
            { name: "idff", type: 3, required: true, description: "ID Free Fire" },
            { name: "senha", type: 3, required: true, description: "Senha" },
            { name: "nome", type: 3, required: true, description: "Nome" },
            { name: "datanasc", type: 3, required: true, description: "Data de nascimento" },
            { name: "paypal_email", type: 3, required: false, description: "E-mail PayPal (opcional)" }
        ]
    },
    {
        name: "dfcaddrem",
        description: "(Admin) Define cargo de registrado e cargo a remover após registro",
        options: [
            { name: "cargo_registrado",
              type: 8, // ROLE
              required: true,
              description: "Cargo que será dado ao usuário ao registrar"
            },
            { name: "cargo_nao_registrado",
              type: 8, // ROLE
              required: true,
              description: "Cargo que será removido do usuário ao registrar"
            }
       ]
    },
    {
        name: "login",
        description: "Login com FF antigo",
        options: [
            { name: "idff", type: 3, required: true, description: "ID Free Fire" },
            { name: "senha", type: 3, required: true, description: "Senha" }
        ]
    },
    {
        name: "mudarperfil",
        description: "Atualiza seu ID-FF, e-mail do PayPal ou senha",
        options: [
            { name: "campo",
              description: "O que deseja alterar",
              type: 3, // STRING
              required: true,
              choices: [
              { name: "ID-FF",       value: "idff"    },
              { name: "PayPal",      value: "paypal"  },
              { name: "Senha FF",    value: "senha"   },
              ]
            },
      {
         name: "novo_valor",
         description: "O novo valor para esse campo",
         type: 3, // STRING
         required: true
      }
      ]
    },
    {
        name: "meuperfil",
        description: "Mostra o teu perfil armazenado no sistema"
    },
    {
        name: "depositar",
        description: "Fazer um depósito (use no DM).",
        options: [
            {
                name: "valor",
                type: 4,
                description: "Valor em sats",
                required: true,
            }
        ],
    },
    {
        name: "ganhar",
        description: "Abra o offerwall e ganhe sats (DM)",
    },
    {
        name: "saldo",
        description: "Mostrar o seu saldo",
    },
    {
        name: "meurefcode",
        description: "Gera (ou mostra) o seu código de referência e ganha 1% dos depósitos de amigos referenciados."
    },
    {
        name: "usarrefcode",
        description: "Usa o código de referência de um amigo para se registar como referenciado.",
        options: [
            {
                name: "codigo",
                type: 3,
                description: "Código de referência",
                required: true
            }
        ]
    },
    {
        name: "banrefcode",
        description: "(Admin).",
        options: [
            {
                name: "utilizador",
                type: 6,
                description: "Utilizador alvo",
                required: true
            }
        ]
    },
    {
        name: "money",
        description: "(Admin).",
        options: [
            {
                name: "utilizador",
                type: 6,
                description: "Utilizador alvo",
                required: true,
            },
            {
                name: "valor",
                type: 4,
                description: "Valor (positivo ou negativo)",
                required: true,
            }
        ],
    },
    {
        name: "oftc",
        description: "(Admin).",
    },
    {
        name: "adsc",
        description: "(Admin).",
    },
    {
        name: "dptc",
        description: "(Admin).",
    },
    {
        name: "wtdc",
        description: "(Admin).",
    },
    {
        name: "dfcadm",
        description: "(Admin).",
        options: [
            {
                name: "cargo",
                type: 8,
                description: "Selecione o cargo.",
                required: true
            }
        ]
    },
    {
        name: "rifasc",
        description: "(Admin)."
    },
    {
        name: "trifasc",
        description: "(Admin)."
    },
    {
        name: "crifa",
        description: "(Admin).",
        options: [
            {
                name: "valor",
                type: 4,
                description: "Valor do bilhete em sats",
                required: true
            },
            {
                name: "numeromaxbilhetes",
                type: 4,
                description: "Número máximo de bilhetes",
                required: true
            }
        ]
    },
    {
        name: "comprarbilheterifa",
        description: "Compra bilhetes de rifa (use no DM).",
        options: [
            {
                name: "idrifa",
                type: 4,
                description: "ID da rifa",
                required: true
            },
            {
                name: "quantidade",
                type: 4,
                description: "Número de bilhetes para comprar",
                required: true
            }
        ]
    },
    {
        name: "drifa",
        description: "(Admin).",
        options: [
            {
                name: "idrifa",
                type: 4,
                description: "ID da rifa a eliminar",
                required: true
            }
        ]
    },
    {
        name: "addloja",
        description: "(Admin).",
        options: [
            { name: "nome",type: 3,required: true, description: "Nome do item" },
            { name: "preco", type: 10, required: true, description: "Preço em usd" },
            { name: "quantidade", type: 4, required: true, description: "Quantidade disponível" },
        ],
    },
    {
        name: "addstock",
        description: "(Admin) Ajusta o stock de um item da loja (ou infinito).",
        options: [
            { name: "id", type: 4, required: true, description: "ID do item" },
            { name: "quantidade", type: 3, required: true, description: "Número ou “infinito”" }
      ]
    },
    {
        name: "dloja",
        description: "(Admin).",
        options: [
            { name: "id", type: 4, required: true, description: "Id do item" },
        ],
    },
    {
        name: "loja",
        description: "Lista dos itens disponíveis na loja.",
    },
    {
        name: "comprar",
        description: "Compra um item da loja (use no DM).",
        options: [
            { name: "id", type: 4, required: true, description: "ID do item" },
            { name: "quantidade", type: 4, required: true, description: "Quantidade a comprar" },
        ],
    },
    {
        name: "donecompra",
        description: "Marca uma compra como concluída",
        options: [
        { name: "id", type: 3, required: true, description: "ID da compra" }
        ]
    },
    {
        name: "dfclider",
        description: "(Admin)",
        options: [
            { name: "equipa", type: 3, required: true, description: "A, B ou C", choices: [
                { name: "A", value: "A" },
                { name: "B", value: "B" },
                { name: "C", value: "C" }
              ]},
        { name: "cargo", type: 8, required: true, description: "Selecione o cargo de líder" }
      ]
   },
   {
       name: "dfcmembroseq",
       description: "(Admin)",
       options: [
           { name: "equipa", type: 3, required: true, description: "A, B ou C", choices: [
               { name: "A", value: "A" },
               { name: "B", value: "B" },
               { name: "C", value: "C" }
             ]},
       { name: "cargo", type: 8, required: true, description: "Selecione o cargo de membro" }
     ]
   },
   {
       name: "cnvdeq",
       description: "Convite de membro para a sua equipa (só líderes)",
       options: [
           { name: "utilizador", type: 6, required: true, description: "@membro a convidar" }
     ]
   },
   {
       name: "removereq",
       description: "Remove um membro da sua equipa (só líderes)",
       options: [
           { name: "utilizador", type: 6, required: true, description: "@membro a remover" },
           { name: "motivo", type: 3, required: true, description: "Motivo da remoção" }
     ]
   },
   {
       name: "adseqc",
       description: "(Admin)",
       options: [
           { name: "equipa", type: 3, required: true, description: "A, B ou C", choices: [
               { name: "A", value: "A" },
               { name: "B", value: "B" },
               { name: "C", value: "C" }
             ]},
       { name: "canal", type: 7, required: true, description: "Selecione o canal de anúncios" }
     ]
   },
   {
       name: "donatec",
       description: "(Admin)",
       options: [
           { name: "canal", type: 7, required: true, description: "Selecione o canal de doações" }
     ]
   },
   {
       name: "doar",
       description: "Doa sats do teu saldo",
       options: [
           { name: "satoshis", type: 4, required: true, description: "Quantidade de sats a doar" }
     ]
    },
    // Comandos de Aposta
    {
        name: "apostar",
        description: "Criar aposta entre duas equipas",
        options: [
            { name: "x", type: 3, required: true, description: "x1/x2/x3/x4" },
            { name: "equipa_a",    type: 6, required: true, description: "@membro1 de A", multiple: true },
            { name: "equipa_b",    type: 6, required: true, description: "@membro1 de B", multiple: true },
            { name: "valor", type: 4, required: true, description: "Valor da aposta" }
        ]
    },
    {
        name: "aceitar",
        description: "Aceita uma aposta",
        options: [
            { name: "id", type: 3, required: true, description: "ID da aposta" }
        ]
    },
    {
        name: "recusar",
        description: "Recusa uma aposta",
        options: [
            { name: "id", type: 3, required: true, description: "ID da aposta" }
        ]
    },
    {
        name: "resultadodoap",
        description: "Regista o resultado da aposta (para cada equipa)",
        options: [
            { name: "id", type: 3, required: true, description: "ID da aposta" },
            { name: "vencedor", type: 3, required: true, description: "Equipa vencedora (A ou B)", choices: [{ name: "A", value: "A" }, { name: "B", value: "B" }] }
        ]
    },
    {
        name: "resultadoapadm",
        description: "Regista o resultado da aposta (Admin) ",
        options: [
            { name: "id", type: 3, required: true, description: "ID da aposta" },
            { name: "vencedor", type: 3, required: true, description: "Equipa vencedora (A ou B)", choices: [{ name: "A", value: "A" }, { name: "B", value: "B" }] }
        ]
    },
];

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
    try {
        console.log("🔄 Registrando Slash Commands...");
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: comandosData });
        console.log("✅ Slash Commands registrados com sucesso!");
    } catch (error) {
        console.error("❌ Erro ao registrar Slash Commands:", error);
    }
})();

// =====================
// Listener de Interações (Slash Commands)
// =====================
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isCommand()) return;
    const { commandName, options } = interaction;

    // Comandos que devem ser usados em DM
    if (["depositar", "comprarbilheterifa", "comprar", "usarrefcode", "registar", "ganhar"].includes(commandName) && interaction.guild) {
        return interaction.reply({ content: "Este comando só pode ser usado em mensagens diretas (DM).", ephemeral: true });
    }

    try {
        if (commandName === "registar") {
            return registarComando(interaction);
        } else if (commandName === "dfcaddrem") {
          const cargoRegistrado = options.getRole("cargo_registrado");
          const cargoNaoRegistrado = options.getRole("cargo_nao_registrado");
          await dfcaddremComando(interaction, cargoRegistrado, cargoNaoRegistrado);
        } else if (commandName === "login") {
            return loginComando(interaction);
        } else if (commandName === "mudarperfil") {
          await mudarPerfilComando(interaction);
        } else if (commandName === "meuperfil") {
          await meuperfilComando(interaction);
        } else if (commandName === "depositar") {
            const valor = options.getInteger("valor");
            await depositarComando(interaction, valor);
        } else if (commandName === "ganhar") {
          await ganharComando(interaction);
        } else if (commandName === "saldo") {
            await saldoComando(interaction);
        } else if (commandName === "meurefcode") {
            await meurefcodeComando(interaction);
        } else if (commandName === "usarrefcode") {
            await usarrefcodeComando(interaction);
        } else if (commandName === "banrefcode") {
            await banrefcodeComando(interaction);
        } else if (commandName === "money") {
            const utilizadorAlvo = options.getUser("utilizador");
            const valor = options.getInteger("valor");
            await moneyComando(interaction, utilizadorAlvo, valor);
        } else if (commandName === "oftc") 
            await oftcComando(interaction);
        } else if (commandName === "adsc") 
            await adscComando(interaction);
        } else if (commandName === "dptc") {
            await dptcComando(interaction);
        } else if (commandName === "wtdc") {
            await wtdcComando(interaction);
        } else if (commandName === "dfcadm") {
            const cargo = options.getRole("cargo");
            await dfcadmComando(interaction, cargo);
        } else if (commandName === "rifasc") {
            await rifascComando(interaction);
        } else if (commandName === "trifasc") {
            await trifascComando(interaction);
        } else if (commandName === "crifa") {
            const valor = options.getInteger("valor");
            const numeromaxbilhetes = options.getInteger("numeromaxbilhetes");
            await crifaComando(interaction, valor, numeromaxbilhetes);
        } else if (commandName === "comprarbilheterifa") {
            const idrifa = options.getInteger("idrifa");
            const quantidade = options.getInteger("quantidade");
            await comprarBilheteRifaComando(interaction, idrifa, quantidade);
        } else if (commandName === "drifa") {
            const idrifa = options.getInteger("idrifa");
            await drifaComando(interaction, idrifa);
        } else if (commandName === "dfclider") {
            const equipa = options.getString("equipa");
            const cargo = options.getRole("cargo");
            await dfcliderComando(interaction, equipa, cargo);
        } else if (commandName === "dfcmembroseq") {
            const equipa = options.getString("equipa");
            const cargo = options.getRole("cargo");
            await dfcmembroseqComando(interaction, equipa, cargo);
        } else if (commandName === "cnvdeq") {
            const alvo = options.getUser("utilizador");
            await convidarEquipeComando(interaction, alvo);
        } else if (commandName === "removereq") {
            const alvo = options.getUser("utilizador");
            const motivo = options.getString("motivo");
            await removerEquipeComando(interaction, alvo, motivo);
        } else if (commandName === "adseqc") {
            const equipa = options.getString("equipa");
            const canal = options.getChannel("canal");
            await adseqcComando(interaction, equipa, canal);
        }
        // Shop Commands
          else if (commandName === "addloja") {
            const nomeItem = options.getString("nome");
            const preco = options.getNumber("preco");
            const quantidade = options.getInteger("quantidade");
            await addlojaComando(interaction, nomeItem, preco, quantidade);
        } else if (commandName === "addstock") {
            const idItem = options.getInteger("id");
            const quantStr = options.getString("quantidade");
            await addstockComando(interaction, idItem, quantStr);
        } else if (commandName === "dloja") {
            const idItem = options.getInteger("id").toString();
            await dlojaComando(interaction, idItem);
        } else if (commandName === "loja") {
            await lojaComando(interaction);
        } else if (commandName === "donecompra") {
            const compraId = options.getString("id");
            await donecompraComando(interaction, compraId);
        } else if (commandName === "comprar") {
            const idItem = options.getInteger("id");
            const quantidade = options.getInteger("quantidade");
            await comprarComando(interaction, idItem, quantidade);
        } else if (commandName === "donatec") {
          const canal = options.getChannel("canal");
          await donatecComando(interaction, canal);
        } else if (commandName === "doar") {
          const sats = options.getInteger("satoshis");
          await doarComando(interaction, sats);
        } //Aposta commands
          else if (commandName === "apostar") {
            const x = options.getString("x");
            const equipaA = options.getUser("equipa_a");
            const equipaB = options.getUser("equipa_b");
            const valor = options.getInteger("valor");
            await apostarComando(interaction, x, equipaA, equipaB, valor);
        } else if (commandName === "aceitar") {
            await aceitarComando(interaction);
        } else if (commandName === "recusar") {
            await recusarComando(interaction);
        } else if (commandName === "resultadodoap") {
            await resultadodoapComando(interaction);
        } else if (commandName === "resultadoapadm") {
            await resultadoapadmComando(interaction);
        }

    } catch (error) {
        console.error(`Erro ao usar o comando ${commandName}:`, error);
        interaction.reply({ content: "Ocorreu um erro ao usar este comando!", ephemeral: true });
    }
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
