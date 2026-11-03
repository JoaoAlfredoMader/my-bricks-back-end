/**
 * The contract used until an organization writes its own: a plain residential lease.
 * It is a starting point, not legal advice: every organization is expected to review it.
 */
export const DEFAULT_TEMPLATE = {
  header: "<h1>CONTRATO DE LOCAÇÃO</h1>",

  clauses: `
<p>Pelo presente instrumento particular, de um lado <strong>{{locador}}</strong>, inscrito(a) sob o documento nº {{documento_locador}}, doravante denominado(a) <strong>LOCADOR(A)</strong>, e de outro lado <strong>{{locatario}}</strong>, inscrito(a) sob o documento nº {{documento_locatario}}, doravante denominado(a) <strong>LOCATÁRIO(A)</strong>, têm entre si justo e contratado o que segue:</p>

<h2>Cláusula 1ª – Do objeto</h2>
<p>O LOCADOR dá em locação ao LOCATÁRIO o imóvel <strong>{{imovel}}</strong>, situado em {{endereco}}, no estado em que se encontra, que o LOCATÁRIO declara conhecer e aceitar.</p>

<h2>Cláusula 2ª – Do prazo</h2>
<p>A locação tem início em <strong>{{data_inicio}}</strong> e término em <strong>{{data_fim}}</strong>.</p>

<h2>Cláusula 3ª – Do aluguel</h2>
<p>O aluguel mensal é de <strong>{{valor_mensal}}</strong>, a ser pago até o dia <strong>{{dia_vencimento}}</strong> de cada mês, pelos meios indicados pelo LOCADOR.</p>

<h2>Cláusula 4ª – Do reajuste</h2>
<p>O valor do aluguel será reajustado a cada doze meses pelo seguinte critério: <strong>{{indice_reajuste}}</strong>.</p>

<h2>Cláusula 5ª – Dos encargos</h2>
<p>Correrão por conta do LOCATÁRIO, enquanto durar a locação:</p>
<ul>
<li>as contas de consumo (água, energia elétrica, gás e internet);</li>
<li>a taxa condominial ordinária e o imposto predial, salvo se ajustado de outra forma por escrito.</li>
</ul>

<h2>Cláusula 6ª – Da conservação</h2>
<p>O LOCATÁRIO obriga-se a conservar o imóvel e a devolvê-lo, ao final da locação, nas mesmas condições em que o recebeu, ressalvado o desgaste natural do uso. Reformas e benfeitorias dependem de autorização prévia e escrita do LOCADOR.</p>

<h2>Cláusula 7ª – Do uso</h2>
<p>O imóvel destina-se ao uso para o qual foi locado, sendo vedada a sublocação, o empréstimo ou a cessão, total ou parcial, sem consentimento escrito do LOCADOR.</p>

<h2>Cláusula 8ª – Da rescisão</h2>
<p>O descumprimento de qualquer cláusula deste contrato autoriza a parte inocente a rescindi-lo, sem prejuízo das penalidades previstas em lei. A desocupação antes do prazo sujeita o LOCATÁRIO à multa proporcional prevista em lei.</p>

<h2>Cláusula 9ª – Do foro</h2>
<p>As partes elegem o foro da situação do imóvel para dirimir quaisquer questões decorrentes deste contrato.</p>

<p>E, por estarem justas e contratadas, firmam o presente instrumento em duas vias de igual teor, em {{data_emissao}}.</p>`.trim(),

  footer: "<p><em>{{imovel}} – contrato emitido em {{data_emissao}}</em></p>",
} as const;
