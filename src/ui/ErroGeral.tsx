import { Component, type ReactNode } from 'react';

/** Se um ecrã rebentar, mostra uma saída em vez de um ecrã branco. Os dados ficam intactos no telemóvel. */
export class ErroGeral extends Component<{ children: ReactNode; chave: string }, { erro: Error | null; chave: string }> {
  state = { erro: null as Error | null, chave: this.props.chave };
  static getDerivedStateFromError(erro: Error) { return { erro }; }
  static getDerivedStateFromProps(p: { chave: string }, s: { erro: Error | null; chave: string }) {
    // Mudar de ecrã limpa o erro.
    return p.chave !== s.chave ? { erro: null, chave: p.chave } : null;
  }
  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div className="cartao space-y-3">
        <p className="font-semibold text-red-800">Este ecrã teve um erro.</p>
        <p className="text-sm text-slate-600">Os teus dados não foram afetados. Volta ao início ou recarrega a app. Se repetir, diz o que estavas a fazer.</p>
        <p className="break-words rounded-lg bg-slate-50 p-2 font-mono text-xs text-slate-500">{this.state.erro.message}</p>
        <button className="btn-primario w-full" onClick={() => { window.location.hash = '#/'; this.setState({ erro: null }); }}>Voltar ao início</button>
        <button className="btn-secundario w-full" onClick={() => window.location.reload()}>Recarregar</button>
      </div>
    );
  }
}
