/*
  regex2mindfa_compiler.c  (UTF-8 epsilon aware)

  PURPOSE
    Read an input file with:
      line 1: regex
      line 2: alphabet
    and write a MACHINE-PARSABLE minimized DFA transition table to an output file.

  REGEX SYNTAX
    - union: | or +
    - kleene star: *
    - parentheses: ( )
    - explicit epsilon: ε   (Greek small letter epsilon, UTF-8)  OR  <eps>
    - concatenation is implicit

  IMPORTANT
    Alphabet symbols are treated as SINGLE-BYTE characters (ASCII-friendly).
    Epsilon is NOT part of the alphabet and is handled specially.

  INPUT FILE FORMAT
    Line 1: regex (may contain UTF-8 'ε' or the ASCII token <eps>)
    Line 2: alphabet symbols, formats accepted:
      ab01
      a b 0 1
      a,b,0,1

  OUTPUT FILE FORMAT (strict, easy to parse)
    ALPHABET <k> <symbols-as-string>
    STATES <n>
    START <s>
    ACCEPT <m> <a0> <a1> ... <a(m-1)>
    TRANS
    <row for state 0: k integers>
    <row for state 1: k integers>
    ...
    END

  COMPILE
    gcc -O2 -Wall -Wextra -std=c11 regex2mindfa_compiler.c -o regex2mindfa

  RUN
    ./regex2mindfa input.txt out.dfa
*/

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <stdint.h>

#define EPS_TOK 1              /* internal single-byte epsilon token */
#define MAX_NFA_STATES 4096
#define MAX_DFA_STATES 4096
#define MAX_ALPHABET   128

static void die(const char* msg) { fprintf(stderr, "Error: %s\n", msg); exit(1); }
static void* xmalloc(size_t n){ void* p=malloc(n); if(!p) die("out of memory"); return p; }
static void* xcalloc(size_t n,size_t s){ void* p=calloc(n,s); if(!p) die("out of memory"); return p; }
static void* xrealloc(void* p,size_t n){ void* q=realloc(p,n); if(!q) die("out of memory"); return q; }

static int is_meta(char c){ return (c=='|'||c=='+'||c=='*'||c=='('||c==')'||c=='.'); }

/* ===== alphabet (runtime) ===== */
static char ALPHABET[MAX_ALPHABET];
static int  ALPHABET_SIZE = 0;

static int is_alphabet_symbol(char c){
    for(int i=0;i<ALPHABET_SIZE;i++) if(ALPHABET[i]==c) return 1;
    return 0;
}

static void parse_alphabet_line(const char* line){
    int seen[256]={0};
    ALPHABET_SIZE=0;

    for(size_t i=0; line[i]; i++){
        unsigned char uc=(unsigned char)line[i];
        char c=line[i];

        if(c=='\n'||c=='\r') continue;
        if(isspace(uc)||c==','||c==';') continue;

        if((unsigned char)c == EPS_TOK) die("alphabet must not contain internal epsilon token");
        if(is_meta(c)) die("alphabet contains meta-operator (| + * ( ) .)");
        // disallow non-ASCII control bytes (for safety)
        if(uc < 32) die("alphabet contains non-printable byte");
        if(seen[uc]) die("alphabet contains duplicate symbol");
        if(ALPHABET_SIZE>=MAX_ALPHABET) die("alphabet too large");

        seen[uc]=1;
        ALPHABET[ALPHABET_SIZE++]=c;
    }
    if(ALPHABET_SIZE==0) die("alphabet is empty");
}

/* ===== regex preprocessing: UTF-8 'ε' and <eps> -> EPS_TOK, then strip spaces ===== */
static char* preprocess_regex(const char* line){
    size_t n = strlen(line);
    // output won't exceed input length (we may shrink)
    char* out = (char*)xmalloc(n + 1);
    size_t j = 0;

    for(size_t i=0;i<n;){
        unsigned char b = (unsigned char)line[i];

        if(b=='\r' || b=='\n') { i++; continue; }
        if(isspace(b)) { i++; continue; }

        // ASCII token <eps>
        if(line[i]=='<' && i+4 < n && strncmp(&line[i], "<eps>", 5)==0){
            out[j++] = (char)EPS_TOK;
            i += 5;
            continue;
        }

        // UTF-8 epsilon: 0xCE 0xB5
        if(i+1 < n && (unsigned char)line[i]==0xCE && (unsigned char)line[i+1]==0xB5){
            out[j++] = (char)EPS_TOK;
            i += 2;
            continue;
        }

        // Otherwise accept single byte as-is
        out[j++] = (char)line[i++];
    }
    out[j]='\0';
    return out;
}

static void check_parentheses_balanced(const char* s){
    int bal=0;
    for(size_t i=0;s[i];i++){
        if(s[i]=='(') bal++;
        else if(s[i]==')') bal--;
        if(bal<0) die("mismatched parentheses: extra ')'");
    }
    if(bal!=0) die("mismatched parentheses: unclosed '('");
}

static void check_regex_symbols_valid(const char* s){
    for(size_t i=0;s[i];i++){
        unsigned char uc = (unsigned char)s[i];
        char c=s[i];

        if(c==(char)EPS_TOK) continue;
        if(is_alphabet_symbol(c)) continue;
        if(c=='|'||c=='+'||c=='*'||c=='('||c==')') continue;
        if(c=='.') die("regex must not contain explicit '.'");
        // If any leftover UTF-8 bytes show up, report clearly
        if(uc >= 128){
            die("regex contains non-ASCII byte. Use UTF-8 'ε' or <eps> only for epsilon; other symbols must be single-byte.");
        }
        {
            char msg[128];
            snprintf(msg,sizeof(msg),"regex contains invalid character: '%c'",c);
            die(msg);
        }
    }
}

static int is_atom_end(char c){ return is_alphabet_symbol(c)|| (unsigned char)c==EPS_TOK || c==')'||c=='*'; }
static int is_atom_start(char c){ return is_alphabet_symbol(c)|| (unsigned char)c==EPS_TOK || c=='('; }
static int need_concat(char a,char b){ return is_atom_end(a)&&is_atom_start(b); }

static char* add_concat_ops(const char* in){
    size_t n=strlen(in);
    char* out=(char*)xmalloc(2*n+2);
    size_t j=0;
    for(size_t i=0;i<n;i++){
        char a=in[i];
        out[j++]=a;
        if(i+1<n){
            char b=in[i+1];
            if(need_concat(a,b)) out[j++]='.';
        }
    }
    out[j]='\0';
    return out;
}

static int prec(char op){
    if(op=='*') return 3;
    if(op=='.') return 2;
    if(op=='|'||op=='+') return 1;
    return 0;
}
static int is_left_assoc(char op){ return op!='*'; }

static char* to_postfix(const char* regex){
    size_t n=strlen(regex);
    char* out=(char*)xmalloc(2*n+2);
    char* st =(char*)xmalloc(2*n+2);
    int top=-1;
    size_t j=0;

    for(size_t i=0;i<n;i++){
        char c=regex[i];
        if(is_alphabet_symbol(c) || (unsigned char)c==EPS_TOK){
            out[j++]=c;
        } else if(c=='('){
            st[++top]=c;
        } else if(c==')'){
            while(top>=0 && st[top]!='(') out[j++]=st[top--];
            if(top<0) die("mismatched parentheses");
            top--;
        } else if(c=='*'){
            out[j++]=c;
        } else if(c=='|'||c=='+'||c=='.'){
            while(top>=0){
                char o2=st[top];
                if(o2=='(') break;
                int p1=prec(c), p2=prec(o2);
                if((is_left_assoc(c)&&p1<=p2) || (!is_left_assoc(c)&&p1<p2)) out[j++]=st[top--];
                else break;
            }
            st[++top]=c;
        } else {
            die("unknown character during postfix conversion");
        }
    }
    while(top>=0){
        if(st[top]=='(') die("mismatched parentheses");
        out[j++]=st[top--];
    }
    out[j]='\0';
    free(st);
    return out;
}

/* ===== Thompson epsilon-NFA ===== */
typedef struct { int to; char sym; } Edge; /* sym==0 => epsilon */
typedef struct { Edge* edges; int n_edges, cap_edges; } NFAState;

static NFAState nfa[MAX_NFA_STATES];
static int nfa_states=0;

static int new_nfa_state(void){
    if(nfa_states>=MAX_NFA_STATES) die("too many NFA states");
    nfa[nfa_states].edges=NULL;
    nfa[nfa_states].n_edges=0;
    nfa[nfa_states].cap_edges=0;
    return nfa_states++;
}
static void add_edge(int from,int to,char sym){
    NFAState* s=&nfa[from];
    if(s->n_edges==s->cap_edges){
        s->cap_edges = s->cap_edges ? s->cap_edges*2 : 4;
        s->edges=(Edge*)xrealloc(s->edges,(size_t)s->cap_edges*sizeof(Edge));
    }
    s->edges[s->n_edges++] = (Edge){to,sym};
}

typedef struct { int start, accept; } Frag;
typedef struct { Frag* a; int top, cap; } FragStack;

static void fs_init(FragStack* fs){ fs->a=NULL; fs->top=0; fs->cap=0; }
static void fs_push(FragStack* fs, Frag f){
    if(fs->top==fs->cap){
        fs->cap = fs->cap ? fs->cap*2 : 16;
        fs->a=(Frag*)xrealloc(fs->a,(size_t)fs->cap*sizeof(Frag));
    }
    fs->a[fs->top++]=f;
}
static Frag fs_pop(FragStack* fs){
    if(fs->top<=0) die("invalid postfix (stack underflow)");
    return fs->a[--fs->top];
}

static Frag postfix_to_nfa(const char* post){
    FragStack st; fs_init(&st);

    for(size_t i=0; post[i]; i++){
        unsigned char uc = (unsigned char)post[i];
        char c=post[i];

        if(is_alphabet_symbol(c)){
            int s=new_nfa_state(), t=new_nfa_state();
            add_edge(s,t,c);
            fs_push(&st,(Frag){s,t});
        } else if(uc==EPS_TOK){
            int s=new_nfa_state(), t=new_nfa_state();
            add_edge(s,t,0);
            fs_push(&st,(Frag){s,t});
        } else if(c=='.'){
            Frag f2=fs_pop(&st), f1=fs_pop(&st);
            add_edge(f1.accept, f2.start, 0);
            fs_push(&st,(Frag){f1.start, f2.accept});
        } else if(c=='|'||c=='+'){
            Frag f2=fs_pop(&st), f1=fs_pop(&st);
            int s=new_nfa_state(), t=new_nfa_state();
            add_edge(s,f1.start,0); add_edge(s,f2.start,0);
            add_edge(f1.accept,t,0); add_edge(f2.accept,t,0);
            fs_push(&st,(Frag){s,t});
        } else if(c=='*'){
            Frag f=fs_pop(&st);
            int s=new_nfa_state(), t=new_nfa_state();
            add_edge(s,f.start,0); add_edge(s,t,0);
            add_edge(f.accept,f.start,0); add_edge(f.accept,t,0);
            fs_push(&st,(Frag){s,t});
        } else {
            die("invalid postfix token");
        }
    }
    if(st.top!=1) die("invalid postfix (stack not singleton)");
    Frag res=fs_pop(&st);
    free(st.a);
    return res;
}

/* ===== Bitset ===== */
typedef struct { uint64_t* w; int nwords; } Bitset;

static Bitset bs_new(int nbits){
    Bitset b;
    b.nwords=(nbits+63)/64;
    b.w=(uint64_t*)xcalloc((size_t)b.nwords,sizeof(uint64_t));
    return b;
}
static void bs_free(Bitset* b){ free(b->w); b->w=NULL; b->nwords=0; }
static void bs_set(Bitset* b,int i){ b->w[i>>6] |= (uint64_t)1 << (i&63); }
static int  bs_get(const Bitset* b,int i){ return (int)((b->w[i>>6]>>(i&63))&1ULL); }
static int  bs_eq(const Bitset* a,const Bitset* b){
    for(int i=0;i<a->nwords;i++) if(a->w[i]!=b->w[i]) return 0;
    return 1;
}
static int bs_empty(const Bitset* a){
    for(int i=0;i<a->nwords;i++) if(a->w[i]) return 0;
    return 1;
}

static void eps_closure(Bitset* out,const Bitset* in){
    for(int i=0;i<out->nwords;i++) out->w[i]=in->w[i];
    int* q=(int*)xmalloc((size_t)nfa_states*sizeof(int));
    int qh=0, qt=0;
    for(int s=0;s<nfa_states;s++) if(bs_get(in,s)) q[qt++]=s;
    while(qh<qt){
        int u=q[qh++];
        NFAState* st=&nfa[u];
        for(int ei=0;ei<st->n_edges;ei++){
            Edge e=st->edges[ei];
            if(e.sym==0 && !bs_get(out,e.to)){
                bs_set(out,e.to);
                q[qt++]=e.to;
            }
        }
    }
    free(q);
}

static void move_on_symbol(Bitset* out,const Bitset* in,char sym){
    for(int i=0;i<out->nwords;i++) out->w[i]=0;
    for(int s=0;s<nfa_states;s++) if(bs_get(in,s)){
        NFAState* st=&nfa[s];
        for(int ei=0;ei<st->n_edges;ei++){
            Edge e=st->edges[ei];
            if(e.sym==sym) bs_set(out,e.to);
        }
    }
}

/* ===== DFA construction ===== */
typedef struct {
    Bitset set;
    int is_accept;
    int trans[MAX_ALPHABET]; /* only [0..ALPHABET_SIZE-1] */
} DFAState;

static DFAState dfa[MAX_DFA_STATES];
static int dfa_n=0;

static int find_dfa_state(const Bitset* s){
    for(int i=0;i<dfa_n;i++) if(bs_eq(&dfa[i].set,s)) return i;
    return -1;
}
static int dfa_add_state(const Bitset* s,int nfa_accept){
    if(dfa_n>=MAX_DFA_STATES) die("too many DFA states");
    dfa[dfa_n].set=bs_new(nfa_states);
    for(int i=0;i<dfa[dfa_n].set.nwords;i++) dfa[dfa_n].set.w[i]=s->w[i];
    dfa[dfa_n].is_accept = bs_get(s,nfa_accept);
    for(int i=0;i<ALPHABET_SIZE;i++) dfa[dfa_n].trans[i]=-1;
    return dfa_n++;
}

static void nfa_to_dfa(int nfa_start,int nfa_accept){
    Bitset init=bs_new(nfa_states);
    bs_set(&init,nfa_start);
    Bitset init_cl=bs_new(nfa_states);
    eps_closure(&init_cl,&init);

    dfa_n=0;
    dfa_add_state(&init_cl,nfa_accept);

    int* q=(int*)xmalloc((size_t)MAX_DFA_STATES*sizeof(int));
    int qh=0,qt=0;
    q[qt++]=0;

    Bitset mv=bs_new(nfa_states);
    Bitset cl=bs_new(nfa_states);

    while(qh<qt){
        int id=q[qh++];
        for(int ai=0;ai<ALPHABET_SIZE;ai++){
            char sym=ALPHABET[ai];
            move_on_symbol(&mv,&dfa[id].set,sym);
            if(bs_empty(&mv)){
                dfa[id].trans[ai]=-1;
                continue;
            }
            eps_closure(&cl,&mv);
            int ex=find_dfa_state(&cl);
            if(ex<0){
                ex=dfa_add_state(&cl,nfa_accept);
                q[qt++]=ex;
            }
            dfa[id].trans[ai]=ex;
        }
    }

    bs_free(&init); bs_free(&init_cl); bs_free(&mv); bs_free(&cl);
    free(q);
}

/* ===== Hopcroft minimization ===== */
typedef struct { int* a; int n,cap; } IntVec;
static void iv_init(IntVec* v){ v->a=NULL; v->n=0; v->cap=0; }
static void iv_push(IntVec* v,int x){
    if(v->n==v->cap){
        v->cap=v->cap? v->cap*2 : 16;
        v->a=(int*)xrealloc(v->a,(size_t)v->cap*sizeof(int));
    }
    v->a[v->n++]=x;
}
static void iv_free(IntVec* v){ free(v->a); v->a=NULL; v->n=v->cap=0; }

static int* dfa_minimize(int* out_min_n,int* out_need_dead,int* out_dead){
    int need_dead=0;
    for(int s=0;s<dfa_n;s++) for(int a=0;a<ALPHABET_SIZE;a++) if(dfa[s].trans[a]==-1) need_dead=1;

    int N=dfa_n+(need_dead?1:0);
    int dead=need_dead? (N-1) : -1;

    *out_need_dead=need_dead;
    *out_dead=dead;

    int* T=(int*)xmalloc((size_t)N*(size_t)ALPHABET_SIZE*sizeof(int));
    int* A=(int*)xmalloc((size_t)N*sizeof(int));

    for(int s=0;s<dfa_n;s++){
        A[s]=dfa[s].is_accept;
        for(int a=0;a<ALPHABET_SIZE;a++){
            int t=dfa[s].trans[a];
            if(t==-1) t=dead;
            T[s*ALPHABET_SIZE+a]=t;
        }
    }
    if(need_dead){
        A[dead]=0;
        for(int a=0;a<ALPHABET_SIZE;a++) T[dead*ALPHABET_SIZE+a]=dead;
    }

    int* cls=(int*)xmalloc((size_t)N*sizeof(int));
    int nF=0,nNF=0;
    for(int s=0;s<N;s++) { if(A[s]) nF++; else nNF++; }
    if(nF==0 || nNF==0){
        for(int s=0;s<N;s++) cls[s]=0;
        *out_min_n=1;
        free(T); free(A);
        return cls;
    }

    IntVec* P=(IntVec*)xcalloc((size_t)N,sizeof(IntVec));
    int Pn=0;

    iv_init(&P[Pn]);
    for(int s=0;s<N;s++) if(A[s]) iv_push(&P[Pn],s);
    Pn++;

    iv_init(&P[Pn]);
    for(int s=0;s<N;s++) if(!A[s]) iv_push(&P[Pn],s);
    Pn++;

    for(int i=0;i<Pn;i++) for(int k=0;k<P[i].n;k++) cls[P[i].a[k]]=i;

    IntVec W; iv_init(&W);
    if(P[0].n<=P[1].n) iv_push(&W,0); else iv_push(&W,1);

    IntVec* inv=(IntVec*)xcalloc((size_t)ALPHABET_SIZE*(size_t)N,sizeof(IntVec));
    for(int a=0;a<ALPHABET_SIZE;a++) for(int q=0;q<N;q++) iv_init(&inv[a*N+q]);

    for(int p=0;p<N;p++){
        for(int a=0;a<ALPHABET_SIZE;a++){
            int q=T[p*ALPHABET_SIZE+a];
            iv_push(&inv[a*N+q],p);
        }
    }

    int* mark=(int*)xmalloc((size_t)N*sizeof(int));

    while(W.n>0){
        int Ablock=W.a[--W.n];

        for(int a=0;a<ALPHABET_SIZE;a++){
            for(int i=0;i<N;i++) mark[i]=0;

            for(int idx=0; idx<P[Ablock].n; idx++){
                int qstate=P[Ablock].a[idx];
                IntVec* pre=&inv[a*N+qstate];
                for(int j=0;j<pre->n;j++) mark[pre->a[j]]=1;
            }

            for(int yi=0; yi<Pn; yi++){
                int cnt=0;
                for(int k=0;k<P[yi].n;k++) if(mark[P[yi].a[k]]) cnt++;
                if(cnt==0 || cnt==P[yi].n) continue;

                IntVec Y1; iv_init(&Y1);
                IntVec Y2; iv_init(&Y2);
                for(int k=0;k<P[yi].n;k++){
                    int s=P[yi].a[k];
                    if(mark[s]) iv_push(&Y1,s); else iv_push(&Y2,s);
                }

                iv_free(&P[yi]);
                P[yi]=Y1;
                int newi=Pn++;
                P[newi]=Y2;

                for(int k=0;k<P[yi].n;k++) cls[P[yi].a[k]]=yi;
                for(int k=0;k<P[newi].n;k++) cls[P[newi].a[k]]=newi;

                int found=-1;
                for(int w=0; w<W.n; w++) if(W.a[w]==yi){ found=w; break; }

                if(found>=0){
                    W.a[found]=yi;
                    iv_push(&W,newi);
                } else {
                    if(P[yi].n<=P[newi].n) iv_push(&W,yi);
                    else iv_push(&W,newi);
                }
            }
        }
    }

    for(int a=0;a<ALPHABET_SIZE;a++) for(int q=0;q<N;q++) iv_free(&inv[a*N+q]);
    free(inv);
    free(mark);
    free(T);
    free(A);

    *out_min_n=Pn;

    for(int i=0;i<Pn;i++) iv_free(&P[i]);
    free(P);
    iv_free(&W);

    return cls;
}

/* ===== write machine-parsable DFA ===== */
static void write_min_dfa(FILE* out,const int* cls,int min_n,int need_dead,int dead){
    int N=dfa_n+(need_dead?1:0);

    int* T=(int*)xmalloc((size_t)N*(size_t)ALPHABET_SIZE*sizeof(int));
    int* A=(int*)xmalloc((size_t)N*sizeof(int));
    for(int s=0;s<dfa_n;s++){
        A[s]=dfa[s].is_accept;
        for(int a=0;a<ALPHABET_SIZE;a++){
            int t=dfa[s].trans[a];
            if(t==-1) t=dead;
            T[s*ALPHABET_SIZE+a]=t;
        }
    }
    if(need_dead){
        A[dead]=0;
        for(int a=0;a<ALPHABET_SIZE;a++) T[dead*ALPHABET_SIZE+a]=dead;
    }

    int* rep=(int*)xmalloc((size_t)min_n*sizeof(int));
    for(int i=0;i<min_n;i++) rep[i]=-1;
    for(int s=0;s<N;s++) if(rep[cls[s]]==-1) rep[cls[s]]=s;

    int* acc=(int*)xcalloc((size_t)min_n,sizeof(int));
    for(int s=0;s<N;s++) if(A[s]) acc[cls[s]]=1;

    int m=0;
    for(int i=0;i<min_n;i++) if(acc[i]) m++;

    fprintf(out,"ALPHABET %d ",ALPHABET_SIZE);
    for(int i=0;i<ALPHABET_SIZE;i++) fputc(ALPHABET[i],out);
    fprintf(out,"\n");
    fprintf(out,"STATES %d\n",min_n);
    fprintf(out,"START %d\n",cls[0]);
    fprintf(out,"ACCEPT %d",m);
    for(int i=0;i<min_n;i++) if(acc[i]) fprintf(out," %d",i);
    fprintf(out,"\n");
    fprintf(out,"TRANS\n");

    for(int c=0;c<min_n;c++){
        int r=rep[c];
        for(int a=0;a<ALPHABET_SIZE;a++){
            int t=T[r*ALPHABET_SIZE+a];
            int tc=cls[t];
            fprintf(out,"%d%s",tc,(a==ALPHABET_SIZE-1)?"":" ");
        }
        fprintf(out,"\n");
    }
    fprintf(out,"END\n");

    free(T); free(A); free(rep); free(acc);
}

/* ===== helpers ===== */
static int read_two_lines(FILE* f,char* l1,size_t n1,char* l2,size_t n2){
    if(!fgets(l1,(int)n1,f)) return 0;
    if(!fgets(l2,(int)n2,f)) return 0;
    return 1;
}

int main(int argc,char** argv){
    if(argc!=3){
        fprintf(stderr,"Usage: %s <input_file> <output_dfa_file>\n",argv[0]);
        return 1;
    }

    FILE* fin=fopen(argv[1],"r");
    if(!fin) die("cannot open input file");

    char line_regex[4096], line_alpha[4096];
    if(!read_two_lines(fin,line_regex,sizeof(line_regex),line_alpha,sizeof(line_alpha))){
        fclose(fin);
        die("input must have 2 lines: regex then alphabet");
    }
    fclose(fin);

    parse_alphabet_line(line_alpha);

    char* regex0=preprocess_regex(line_regex);
    if(regex0[0]=='\0') die("empty regex");
    check_regex_symbols_valid(regex0);
    check_parentheses_balanced(regex0);

    for(int i=0;i<nfa_states;i++) free(nfa[i].edges);
    nfa_states=0;
    for(int i=0;i<dfa_n;i++) bs_free(&dfa[i].set);
    dfa_n=0;

    char* regex1=add_concat_ops(regex0);
    char* post=to_postfix(regex1);

    Frag frag=postfix_to_nfa(post);
    nfa_to_dfa(frag.start,frag.accept);

    int min_n=0, need_dead=0, dead=-1;
    int* cls=dfa_minimize(&min_n,&need_dead,&dead);

    FILE* fout=fopen(argv[2],"w");
    if(!fout) die("cannot open output file for writing");
    write_min_dfa(fout,cls,min_n,need_dead,dead);
    fclose(fout);

    free(cls);
    free(regex0); free(regex1); free(post);
    for(int i=0;i<nfa_states;i++) free(nfa[i].edges);
    for(int i=0;i<dfa_n;i++) bs_free(&dfa[i].set);
    return 0;
}
