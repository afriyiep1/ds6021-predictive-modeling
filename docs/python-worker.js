// Python executes in a worker; Stop terminates it without blocking the reading page.
let runtime;
const CDN='https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
const send=(type,data={})=>self.postMessage({type,...data});
async function prepare(base){
 if(runtime)return runtime;
 send('status',{text:'Downloading Python and scientific packages… The first run may take a minute.'});
 const {loadPyodide}=await import(CDN+'pyodide.mjs');
 const py=await loadPyodide({indexURL:CDN});
 await py.loadPackage(['numpy','pandas','matplotlib','scikit-learn']);
 for(const name of ['PlanetsData.csv','insurance.csv','Startups.csv']){
  const response=await fetch(new URL('datasets/'+name,base));
  if(!response.ok)throw Error('Could not load '+name);
  py.FS.writeFile('/home/pyodide/'+name,new Uint8Array(await response.arrayBuffer()));
 }
 await py.runPythonAsync('import os\nos.chdir("/home/pyodide")\nimport matplotlib\nmatplotlib.use("Agg")');
 runtime=py;return py;
}
self.onmessage=async({data})=>{
 let env;
 try{
  const py=await prepare(data.base);
  send('status',{text:'Running your Python…'});
  env=py.toPy({});
  await py.runPythonAsync(`import io, contextlib, traceback, json, base64
import matplotlib.pyplot as plt
_browser_stdout = io.StringIO()
_browser_images = []
def _browser_show(*args, **kwargs):
    for number in plt.get_fignums():
        figure = plt.figure(number)
        buffer = io.BytesIO()
        figure.savefig(buffer, format="png", dpi=140, bbox_inches="tight")
        _browser_images.append(base64.b64encode(buffer.getvalue()).decode("ascii"))
    plt.close("all")
plt.close("all")
plt.show = _browser_show
`,{globals:env});
  env.set('_browser_code',data.code);
  await py.runPythonAsync(`_browser_error = ""
try:
    with contextlib.redirect_stdout(_browser_stdout), contextlib.redirect_stderr(_browser_stdout):
        exec(compile(_browser_code, "book-example.py", "exec"), globals())
except Exception:
    _browser_error = traceback.format_exc()
_browser_result = json.dumps({"text": _browser_stdout.getvalue(), "images": _browser_images, "error": _browser_error})
`,{globals:env});
  send('result',JSON.parse(env.get('_browser_result')));
 }catch(error){send('error',{text:'Python could not run: '+error.message+'. Check your connection or use the downloadable script in Colab.'});runtime=null;}
 finally{if(env)env.destroy();}
};
